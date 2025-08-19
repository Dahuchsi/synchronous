// functions/index.js

// Firebase v2, Node.js 20+
const { onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

// --- Configuration ---
// IMPORTANT: Replace this with your app's actual deployed URL
const APP_URL = 'https://synchronous.dahuchsi.net';
const APP_NAME = 'Synchronous Notes';
const GEMINI_API_KEY = defineSecret('GEMINI_KEY');
// You must also set your SendGrid key as a secret:
// firebase functions:secrets:set SENDGRID_KEY

// Initialize Admin SDK once
admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = require('firebase-admin/firestore');

// --- Helper Functions ---
function getSendGridKey() {
  // In v2, secrets are the recommended way. Fallbacks are for convenience.
  try {
    return process.env.SENDGRID_KEY || (require('firebase-functions').config()?.sendgrid?.key);
  } catch {
    return process.env.SENDGRID_KEY || null;
  }
}

function getSendGridFrom() {
  return process.env.SENDGRID_FROM || 'hello@your-app-domain.com';
}

// --- Callable Functions ---

/**
 * Callable: Gemini proxy.
 */
exports.callGeminiV2 = onCall(
  { region: 'us-central1', cors: true, secrets: [GEMINI_API_KEY] },
  async (request) => {
    try {
      const prompt = String(request.data?.prompt || '').trim();
      if (!prompt) return { error: 'Missing prompt' };

      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) {
        logger.error('GEMINI_KEY secret not set');
        return { error: 'Server not configured' };
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });

      const body = await res.json();

      if (!res.ok) {
        const msg = body?.error?.message || `Gemini HTTP ${res.status}`;
        logger.error('Gemini error', { status: res.status, body });
        return { error: msg };
      }

      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
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

/**
 * NEW & CRITICAL: Callable function to accept a collaboration invite.
 * This function adds the user to the note's 'collaborators' array.
 */
exports.acceptInvite = onCall({ region: 'us-central1', cors: true }, async (request) => {
  const newCollaboratorId = request.auth?.uid;
  const { ownerId, noteId } = request.data;

  if (!newCollaboratorId) {
    throw new Error('You must be logged in to accept an invite.');
  }
  if (!ownerId || !noteId) {
    throw new Error('Missing ownerId or noteId.');
  }

  try {
    const noteRef = db.collection('users').doc(ownerId).collection('notes').doc(noteId);

    // Securely add the new user's ID to the 'collaborators' array.
    // arrayUnion prevents duplicates if they are already a collaborator.
    await noteRef.update({
      collaborators: FieldValue.arrayUnion(newCollaboratorId),
    });

    logger.info(`User ${newCollaboratorId} accepted invite for note ${noteId} from owner ${ownerId}`);
    return { success: true, message: 'You can now collaborate on this note!' };
  } catch (error) {
    logger.error('Error accepting invite:', error);
    throw new Error('Could not accept invite. The note may have been deleted.');
  }
});


// --- Firestore Triggers ---

/**
 * FIXED: Sends an invite email with a proper link and sender name.
 */
exports.sendInviteEmailV2 = onDocumentCreated({ region: 'us-central1', document: 'invites/{inviteId}' }, async (event) => {
  const snap = event.data;
  if (!snap) return;

  const inv = snap.data();
  const sendgridKey = getSendGridKey();
  if (!sendgridKey) {
    logger.error('SENDGRID_KEY secret not set!');
    return snap.ref.update({ status: 'error', error: 'SendGrid key missing' });
  }

  // --- FIX IMPLEMENTED HERE ---
  // 1. Construct the deep link to your application
  const inviteLink = `${APP_URL}/invite?ownerId=${inv.fromUserId}&noteId=${inv.noteId}`;

  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(sendgridKey);

  const msg = {
    to: inv.toEmail,
    // 2. Set the sender name and use a verified email address
    from: {
      email: getSendGridFrom(),
      name: APP_NAME,
    },
    subject: `${inv.fromName} invited you to collaborate on a note`,
    html: `
      <p>You've been invited to collaborate on "<strong>${inv.noteTitle || 'a note'}</strong>".</p>
      <p><a href="${inviteLink}">Click here to open the note and accept the invite.</a></p>
    `,
  };

  try {
    await sgMail.send(msg);
    await snap.ref.update({
      status: 'sent',
      sentAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.error('SendGrid error', err);
    await snap.ref.update({ status: 'error', error: String(err) });
  }
});

/**
 * FIXED: Path is corrected to match your Firestore structure.
 * Notifies collaborators when they are added to a note.
 */
exports.notifyOnCollaboratorsChangeV2 = onDocumentUpdated({ region: 'us-central1', document: 'users/{ownerId}/notes/{noteId}' }, async (event) => {
  const beforeData = event.data?.before?.data() || {};
  const afterData = event.data?.after?.data() || {};

  const beforeCollab = beforeData.collaborators || [];
  const afterCollab = afterData.collaborators || [];

  // Find which users were newly added
  const addedCollaborators = afterCollab.filter((uid) => !beforeCollab.includes(uid));

  if (addedCollaborators.length === 0) {
    return;
  }
  
  logger.info(`New collaborators added to note ${event.params.noteId}:`, addedCollaborators);
  // In a full app, you would add logic here to send a push notification (FCM)
  // to the newly added users to let them know they've been granted access.
});