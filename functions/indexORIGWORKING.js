// functions/index.js (Firebase Functions v2, Node.js 20+)
const { onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

// FIXED: Import defineSecret from the correct module
const { defineSecret } = require('firebase-functions/params');
const geminiKey = defineSecret('GEMINI_KEY');

// Initialize Admin SDK once
try {
  admin.initializeApp();
} catch (_) {}

const db = admin.firestore();
const messaging = admin.messaging();

// Helpers: read keys from multiple possible env names or functions config
function getSendGridKey() {
  try {
    return (
      process.env.SENDGRID_API_KEY ||
      process.env.SENDGRID_KEY ||
      (require('firebase-functions').config()?.sendgrid?.key) ||
      null
    );
  } catch {
    return process.env.SENDGRID_API_KEY || process.env.SENDGRID_KEY || null;
  }
}

function getSendGridFrom() {
  return process.env.SENDGRID_FROM || 'contact@dahuchsi.com';
}

/**
 * Callable: Gemini proxy (v2). New name to avoid 1st-gen upgrade conflict.
 * Client should call httpsCallable('callGeminiV2').
 * Always returns: { text } on success, { error } on failure.
 */
exports.callGeminiV2 = onCall(
  // The crucial fix: add the 'secrets' array to the options object
  { region: 'us-central1', cors: true, timeoutSeconds: 60, memory: '256MiB', secrets: [geminiKey] },
  async (request) => {
    try {
      // Accept either { prompt } or legacy { text }
      const promptRaw = request.data?.prompt ?? request.data?.text ?? '';
      const prompt = String(promptRaw || '').trim();
      if (!prompt) return { error: 'Missing prompt' };

      // Get the API key from the secret store
      const apiKey = geminiKey.value();
      if (!apiKey) {
        logger.error('GEMINI_API_KEY secret not set');
        return { error: 'Server not configured' };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${encodeURIComponent(
        apiKey
      )}`;

      // Node 20+: global fetch
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      const bodyStr = await res.text();
      let body;
      try {
        body = bodyStr ? JSON.parse(bodyStr) : {};
      } catch (e) {
        logger.error('Gemini non-JSON response', bodyStr);
        return { error: 'Upstream returned non-JSON' };
      }

      if (!res.ok) {
        const msg = body?.error?.message || `Gemini HTTP ${res.status}`;
        logger.error('Gemini error', { status: res.status, body });
        return { error: msg };
      }

      // Normalize to plain text
      let text = '';
      const parts = body?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        text = parts.map((p) => p?.text || '').join('\n').trim();
      }
      if (!text && body?.candidates?.[0]?.output_text) text = (body.candidates[0].output_text || '').trim();
      if (!text && body?.text) text = (body.text || '').trim();

      if (!text) {
        logger.error('Gemini: No text in response', body);
        return { error: 'No text returned from model' };
      }

      return { text };
    } catch (err) {
      logger.error('callGeminiV2 error', err);
      return { error: err?.message || 'Unknown error' };
    }
  }
);

// Firestore trigger: send email on invite creation (v2 name)
exports.sendInviteEmailV2 = onDocumentCreated(
  { region: 'us-central1', document: 'invites/{inviteId}', timeoutSeconds: 60, memory: '256MiB' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const inv = snap.data() || {};
    const toEmail = inv.toEmail;
    const noteTitle = inv.noteTitle || 'a note';
    const fromName = inv.fromName || 'A user';

    const sendgridKey = getSendGridKey();
    if (!sendgridKey) {
      logger.error('SENDGRID_API_KEY/SENDGRID_KEY not set (functions config or env)');
      await snap.ref.update({ status: 'error', error: 'SendGrid key missing' });
      return;
    }

    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(sendgridKey);

    const msg = {
      to: toEmail,
      from: getSendGridFrom(), // must be verified in SendGrid
      subject: `${fromName} invited you to collaborate on a note`,
      text: `You've been invited to collaborate on "${noteTitle}". Open the app to accept the invite.`,
      html: `<p>You've been invited to collaborate on "<strong>${noteTitle}</strong>".</p>
               <p>Open the app to accept the invite.</p>`,
    };

    try {
      await sgMail.send(msg);
      await snap.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.error('SendGrid error', err);
      await snap.ref.update({ status: 'error', error: String(err) });
    }
  }
);

// Firestore trigger: notify collaborators when collaborators list changes (v2 name)
exports.notifyOnCollaboratorsChangeV2 = onDocumentUpdated(
  {
    region: 'us-central1',
    document: 'artifacts/{projectId}/users/{uid}/notes/{noteId}',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const beforeCollab = Array.isArray(before.collaborators) ? before.collaborators : [];
    const afterCollab = Array.isArray(after.collaborators) ? after.collaborators : [];

    const added = afterCollab.filter((u) => !beforeCollab.includes(u));
    if (added.length === 0) return;

    // Collect FCM tokens from /users/{uid}/tokens/*
    const tokens = [];
    try {
      await Promise.all(
        added.map(async (uid) => {
          const tokensSnap = await db.collection(`users/${uid}/tokens`).get();
          tokensSnap.forEach((doc) => {
            const t = doc.data()?.token;
            if (t) tokens.push(t);
          });
        })
      );
    } catch (err) {
      logger.error('Error fetching FCM tokens', err);
    }

    if (tokens.length === 0) return;

    try {
      await messaging.sendMulticast({
        tokens,
        notification: {
          title: 'New shared note',
          body: after.title || 'A note was shared with you',
        },
      });
    } catch (err) {
      logger.error('FCM sendMulticast error', err);
    }
  }
);