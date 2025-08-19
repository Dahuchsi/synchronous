// This is the complete and final App.jsx file.
/* eslint-disable no-undef */
import { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  onSnapshot,
  collection,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import debounce from 'lodash.debounce';

// Read Firebase config from environment variables
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

// Auto-contrast for text color when background changes
const lightBgClasses = new Set([
  'bg-white',
  'bg-yellow-100',
  'bg-blue-100',
  'bg-green-100',
  'bg-red-100',
  'bg-purple-100',
  'bg-pink-100',
  'bg-orange-100',
  'bg-gray-100',
]);
function getAutoTextColor(bgClass) {
  return lightBgClasses.has(bgClass) ? '#111111' : '#FFFFFF';
}

// Rich text commands
const execCommand = (command, value = null) => {
  document.execCommand(command, false, value);
};

// Strip hidden bidi marks and any rtl/auto direction attributes/styles
function stripBidi(textOrHtml = '') {
  return (textOrHtml || '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\sdir=("|')(?:rtl|auto|ltr)\1/gi, '')
    .replace(/\sstyle=("')[^"]*direction\s*:\s*(rtl|auto)[^"]*\1/gi, '');
}

// Dark mode preference
function usePrefersDarkMode() {
  const [prefersDarkMode, setPrefersDarkMode] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event) => setPrefersDarkMode(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  return prefersDarkMode;
}

const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [funcs, setFuncs] = useState(null);
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [notes, setNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const activeNote = notes.find((note) => note.id === activeNoteId);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [message, setMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginView, setIsLoginView] = useState(true);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('modified');
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const editorRef = useRef(null);
  const prefersDarkMode = usePrefersDarkMode();

  // Initialize Firebase
  useEffect(() => {
    if (!firebaseConfig || !firebaseConfig.apiKey) {
      console.error('Firebase config is missing or invalid.');
      setIsAuthReady(true);
      return;
    }
    const app = initializeApp(firebaseConfig);
    const firestore = getFirestore(app);
    const firebaseAuth = getAuth(app);
    const functions = getFunctions(app, process.env.REACT_APP_FUNCTIONS_REGION || 'us-central1');

    setDb(firestore);
    setAuth(firebaseAuth);
    setFuncs(functions);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setUserId(currentUser.uid);
      } else {
        setUserId(null);
        setNotes([]);
	setActiveNoteId(null);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to user's notes
  useEffect(() => {
    if (!db || !userId) {
        setNotes([]); // Clear notes when logged out
        return;
    };

    const notesRef = collection(db, `users/${userId}/notes`);
    const q = query(notesRef, orderBy('modifiedAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notesData = snapshot.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          title: data.title || 'Untitled',
          content: data.content || '',
          color: data.color || 'bg-white',
          textColor: data.textColor || getAutoTextColor(data.color || 'bg-white'),
          collaborators: data.collaborators || [],
          tags: data.tags || [],
          createdAt: data.createdAt?.toDate() || new Date(),
          modifiedAt: data.modifiedAt?.toDate() || new Date(),
        };
      });
      setNotes(notesData);
    }, (error) => {
        console.error("Snapshot error:", error);
        setMessage("Could not fetch notes. Check Firestore rules.");
        setTimeout(() => setMessage(null), 5000);
    });

    return () => unsubscribe();
  }, [db, userId]);

  // Sync activeNote state with the main notes list

  // Dark mode initialization/persistence
  useEffect(() => {
    const savedTheme = localStorage.getItem('darkMode');
    if (savedTheme !== null) {
      setIsDarkMode(JSON.parse(savedTheme));
    } else {
      setIsDarkMode(prefersDarkMode);
    }
  }, [prefersDarkMode]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  // Set editor content when active note changes
  useEffect(() => {
    if (activeNote && editorRef.current) {
        if(editorRef.current.innerHTML !== activeNote.content) {
            editorRef.current.innerHTML = activeNote.content || '';
        }
    }
  }, [activeNote]);

  // Effect to handle checklist changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const handleCheckboxChange = (event) => {
      if (event.target.matches('.checklist-checkbox')) {
        setTimeout(() => handleNoteChange(), 50);
      }
    };

    editor.addEventListener('change', handleCheckboxChange);
    return () => {
      if (editor) {
        editor.removeEventListener('change', handleCheckboxChange);
      }
    };
  }, [activeNote]);

  // Select a note
  const handleSelectNote = (note) => {
  setActiveNoteId(note.id);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  // Debounced saving
const debouncedSaveNote = useCallback(
  debounce(async (updatedNote) => {
    // This function will be re-created when db or userId are no longer null
    if (!db || !userId || !updatedNote.id) return;
    try {
      const noteRef = doc(db, `users/${userId}/notes`, updatedNote.id);
      const noteToSave = {
        title: updatedNote.title || 'Untitled',
        content: updatedNote.content || '',
        color: updatedNote.color || 'bg-white',
        textColor: updatedNote.textColor || getAutoTextColor(updatedNote.color || 'bg-white'),
        tags: updatedNote.tags || [],
        modifiedAt: serverTimestamp(),
      }
      await updateDoc(noteRef, noteToSave);
    } catch (error) {
      console.error('Error saving note:', error);
      setMessage('Failed to save note.');
      setTimeout(() => setMessage(null), 3000);
    }
  }, 500),
  [db, userId] // Dependency array: tells React to recreate this when db or userId changes
);

  // Editor input handler
  const handleNoteChange = () => {
  if (!activeNote || !editorRef.current) return;
  const content = editorRef.current.innerHTML;
  if (content === activeNote.content) return;

  // Optimistically update the main notes array for a responsive UI
  const updatedNotes = notes.map(note =>
    note.id === activeNoteId ? { ...note, content } : note
  );
  setNotes(updatedNotes);

  // Debounce the save with the updated note object
  debouncedSaveNote({ ...activeNote, content });
};

  // Clean paste to plain text
  const handlePaste = (e) => {
    e.preventDefault();
    const text = stripBidi((e.clipboardData || window.clipboardData).getData('text/plain') || '');
    document.execCommand('insertText', false, text);
    setTimeout(() => handleNoteChange(), 10);
  };

  // Title change handler
  const handleTitleChange = (e) => {
  if (!activeNote) return;
  const title = stripBidi(e.target.value);

  // Optimistically update the main notes array
  const updatedNotes = notes.map(note =>
    note.id === activeNoteId ? { ...note, title } : note
  );
  setNotes(updatedNotes);

  // Debounce the save
  debouncedSaveNote({ ...activeNote, title });
};

  // Add a new note
  const addNote = async () => {
    if (!db || !userId) return;
    const newNote = {
      title: 'New Note',
      content: '',
      color: 'bg-white',
      textColor: getAutoTextColor('bg-white'),
      collaborators: [],
      tags: [],
      createdAt: serverTimestamp(),
      modifiedAt: serverTimestamp(),
    };
    try {
      const docRef = await addDoc(collection(db, `users/${userId}/notes`), newNote);
      const noteWithId = { ...newNote, id: docRef.id, createdAt: new Date(), modifiedAt: new Date() };
      setActiveNoteId(docRef.id);
    } catch (e) {
      console.error('Error adding document: ', e);
      setMessage('Failed to create note. Please try again.');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // Delete note
  const deleteNote = async (id) => {
    if (!db || !userId) return;
    try {
      await deleteDoc(doc(db, `users/${userId}/notes`, id));
      if (activeNoteId === id) setActiveNoteId(null);
      setMessage('Note deleted successfully.');
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      console.error('Error deleting document: ', e);
      setMessage('Failed to delete note.');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // Note background color change
const handleColorChange = (color) => {
  if (!activeNote) return;
  const autoTextColor = getAutoTextColor(color);
  
  // Optimistically update the main notes array
  const updatedNotes = notes.map(note =>
    note.id === activeNoteId ? { ...note, color, textColor: autoTextColor } : note
  );
  setNotes(updatedNotes);
  
  debouncedSaveNote({ ...activeNote, color, textColor: autoTextColor });
  setShowColorPicker(false);
};
  // Manual text color override
const handleTextColorChange = (colorHex) => {
  if (!activeNote) return;
  
  // Optimistically update the main notes array
  const updatedNotes = notes.map(note =>
    note.id === activeNoteId ? { ...note, textColor: colorHex } : note
  );
  setNotes(updatedNotes);

  debouncedSaveNote({ ...activeNote, textColor: colorHex });
};

  // Tag handling functions
const handleAddTag = () => {
  if (!activeNote || !tagInput.trim()) return;
  const newTag = tagInput.trim().toLowerCase();
  if (activeNote.tags?.includes(newTag)) {
    setTagInput('');
    return;
  };
  const updatedTags = [...(activeNote.tags || []), newTag];
  
  // Optimistically update the main notes array
  const updatedNotes = notes.map(note =>
    note.id === activeNoteId ? { ...note, tags: updatedTags } : note
  );
  setNotes(updatedNotes);

  debouncedSaveNote({ ...activeNote, tags: updatedTags });
  setTagInput('');
};

const handleRemoveTag = (tagToRemove) => {
  if (!activeNote) return;
  const updatedTags = activeNote.tags.filter(tag => tag !== tagToRemove);
  
  // Optimistically update the main notes array
  const updatedNotes = notes.map(note =>
    note.id === activeNoteId ? { ...note, tags: updatedTags } : note
  );
  setNotes(updatedNotes);

  debouncedSaveNote({ ...activeNote, tags: updatedTags });
};

  // Invite modal
  const toggleInviteModal = () => {
    setShowInviteModal(!showInviteModal);
    setMessage(null);
    setInviteEmail('');
  };

  // Create an invite document (Cloud Function will email)
  const handleInviteUser = async () => {
    if (!db || !userId || !activeNote) return;
    // NOTE: Sharing logic would need to be updated to work with the new secure rules.
    // This currently only creates an invite but doesn't grant permissions.
    try {
      const inviteDoc = {
        fromUserId: userId,
        fromEmail: user?.email || '',
        fromName: user?.email?.split('@')[0] || 'A user',
        toEmail: inviteEmail,
        noteId: activeNote.id,
        noteTitle: activeNote.title || 'Untitled',
        status: 'pending',
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, 'invites'), inviteDoc);
      setMessage('Invite created! Your backend function will process it shortly.');
      setTimeout(() => {
        setMessage(null);
        setShowInviteModal(false);
      }, 2000);
    } catch (e) {
      console.error('Error creating invite: ', e);
      setMessage('Failed to create invite.');
    }
  };

  // Auth functions
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!auth) return;
    setIsLoading(true);
    setMessage(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error('Login failed:', error);
      setMessage(`Login failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!auth) return;
    setIsLoading(true);
    setMessage(null);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error('Signup failed:', error);
      setMessage(`Signup failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    setActiveNoteId(null);
    setNotes([]);
  };

  // Gemini via Firebase Callable Function
  const callGeminiApi = async (prompt) => {
    if (!funcs) throw new Error('Functions not initialized');
    const call = httpsCallable(funcs, 'callGeminiV2');
    const { data } = await call({ prompt });
    if (data?.error) throw new Error(data.error);
    const text = (data?.text || '').trim();
    if (!text) throw new Error('Gemini: empty response');
    return text;
  };

  const handleGenerateRecipe = async () => {
    if (!activeNote || !editorRef.current) return;
    setIsLoading(true);
    setMessage('Generating recipe...');
    const ingredients = stripBidi(editorRef.current.innerText.trim());
    if (!ingredients) {
      setMessage('Please add some ingredients first!');
      setIsLoading(false);
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    const prompt = `Based on the following ingredients, create a delicious recipe. Format it nicely with a title, ingredients list, and step-by-step instructions:\n\nIngredients: ${ingredients}\n\nPlease provide a complete recipe that's easy to follow.`;
    try {
      const generatedContent = await callGeminiApi(prompt);
      const formattedContent = generatedContent.replace(/\n/g, '<br/>');
      const newContent = `${activeNote.content || ''}<br/><br/><div class="recipe-section"><h3>🍳 Generated Recipe</h3><div class="recipe-content">${formattedContent}</div></div>`;
const updatedNotes = notes.map(note =>
  note.id === activeNoteId ? { ...note, content: newContent } : note
);
setNotes(updatedNotes);
debouncedSaveNote({ ...activeNote, content: newContent });
      if (editorRef.current) {
        editorRef.current.innerHTML = newContent;
        setTimeout(() => {
          if (editorRef.current) {
            const range = document.createRange();
            const selection = window.getSelection();
            range.selectNodeContents(editorRef.current);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }, 10);
      }
      setMessage('Recipe generated successfully!');
    } catch (error) {
      console.error('Error generating recipe:', error);
      setMessage(error.message || 'Failed to generate recipe.');
    } finally {
      setIsLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handlePlanItinerary = async () => {
    if (!activeNote || !editorRef.current) return;
    setIsLoading(true);
    setMessage('Planning your itinerary...');
    const locations = stripBidi(editorRef.current.innerText.trim());
    if (!locations) {
      setMessage('Please add some locations first!');
      setIsLoading(false);
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    const prompt = `Create a detailed travel itinerary for the following locations. Include suggested activities, timing, and tips:\n\nLocations: ${locations}\n\nPlease organize this into a day-by-day itinerary.`;
    try {
      const generatedContent = await callGeminiApi(prompt);
      const formattedContent = generatedContent.replace(/\n/g, '<br/>');
      const newContent = `${activeNote.content || ''}<br/><br/><div class="itinerary-section"><h3>✈️ Generated Itinerary</h3><div class="itinerary-content">${formattedContent}</div></div>`;
      const updatedNotes = notes.map(note =>
      note.id === activeNoteId ? { ...note, content: newContent } : note
    );
    setNotes(updatedNotes);
    debouncedSaveNote({ ...activeNote, content: newContent });
      if (editorRef.current) {
        editorRef.current.innerHTML = newContent;
        setTimeout(() => {
          if (editorRef.current) {
            const range = document.createRange();
            const selection = window.getSelection();
            range.selectNodeContents(editorRef.current);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }, 10);
      }
      setMessage('Itinerary generated successfully!');
    } catch (error) {
      console.error('Error planning itinerary:', error);
      setMessage(error.message || 'Failed to plan itinerary.');
    } finally {
      setIsLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // Filter + sort
  const filteredAndSortedNotes = (notes || [])
    .filter((note) => {
      const t = (note.title || '').toLowerCase();
      const c = (note.content || '').toLowerCase().replace(/<[^>]*>/g, '');
      const noteTags = (note.tags || []).join(' ').toLowerCase();
      const q = (searchTerm || '').toLowerCase();
      if (q.startsWith('#')) {
          return noteTags.includes(q.substring(1));
      }
      return t.includes(q) || c.includes(q) || noteTags.includes(q);
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return (a.title || '').localeCompare(b.title || '');
        case 'created':
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case 'modified':
        default:
          return new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0);
      }
    });

  // Loading and Auth views
  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="dark:text-gray-200">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 font-sans">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-200 mb-2">Synchronous Notes</h1>
            <p className="text-gray-600 dark:text-gray-400">Your thoughts, synchronized</p>
          </div>
          <h2 className="text-2xl font-semibold text-center mb-6 text-gray-800 dark:text-gray-200">
            {isLoginView ? 'Welcome Back' : 'Create Account'}
          </h2>
          <form onSubmit={isLoginView ? handleLogin : handleSignup}>
            <div className="mb-4">
              <label className="block text-gray-700 dark:text-gray-300 mb-2 font-medium" htmlFor="email">
                Email Address
              </label>
              <input
                type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="you@example.com" required
              />
            </div>
            <div className="mb-6">
              <label className="block text-gray-700 dark:text-gray-300 mb-2 font-medium" htmlFor="password">
                Password
              </label>
              <input
                type="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="••••" required
              />
            </div>
            {message && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{message}</div>
            )}
            <button
              type="submit" disabled={isLoading}
              className="w-full px-4 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400"
            >
              {isLoading ? 'Processing...' : (isLoginView ? 'Sign In' : 'Create Account')}
            </button>
          </form>
          <div className="text-center mt-6 text-sm text-gray-600 dark:text-gray-400">
            {isLoginView ? (
              <span>
                Don't have an account?{' '}
                <button
                  onClick={() => { setIsLoginView(false); setMessage(null); }}
                  className="text-blue-500 hover:text-blue-600 font-medium hover:underline"
                >
                  Sign up
                </button>
              </span>
            ) : (
              <span>
                Already have an account?{' '}
                <button
                  onClick={() => { setIsLoginView(true); setMessage(null); }}
                  className="text-blue-500 hover:text-blue-600 font-medium hover:underline"
                >
                  Sign in
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden font-sans bg-gray-50 dark:bg-gray-900">
      <header className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-blue-600 dark:text-blue-400">Synchronous Notes</h1>
          <div className="hidden md:flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
            <span>{notes.length} notes</span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="relative hidden md:block">
            <input
              type="text" placeholder="Search notes or #tags..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm w-64"
            />
            <svg className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-sm hidden md:inline">Dark</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={isDarkMode} onChange={() => setIsDarkMode(!isDarkMode)} />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <button
            onClick={addNote}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition-colors duration-200 text-sm font-medium"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Note
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg shadow-sm hover:bg-gray-700 transition-colors duration-200 text-sm font-medium"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Logout
          </button>
        </div>
      </header>

      {message && (
        <div className="bg-blue-50 dark:bg-blue-900 border-l-4 border-blue-400 p-4 text-blue-700 dark:text-blue-200 text-sm">{message}</div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Notes</h2>
              <select
                value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 dark:bg-gray-700 dark:text-white"
              >
                <option value="modified">Modified</option>
                <option value="created">Created</option>
                <option value="title">Title</option>
              </select>
            </div>
            <div className="md:hidden relative">
              <input
                type="text" placeholder="Search notes or #tags..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white text-sm"
              />
              <svg className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredAndSortedNotes.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                {searchTerm ? 'No notes match your search.' : 'No notes yet. Create one!'}
              </div>
            ) : (
              <div className="p-2">
                {filteredAndSortedNotes.map((note) => (
                  <div
                    key={note.id} onClick={() => handleSelectNote(note)}
                    className={`p-3 mb-2 rounded-lg cursor-pointer transition-all duration-200 hover:shadow-md ${
                      activeNote?.id === note.id
                        ? 'bg-blue-50 dark:bg-blue-900 border-2 border-blue-500'
                        : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm">
                          {note.title || 'Untitled'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {new Date(note.modifiedAt).toLocaleString()}
                        </div>
                        {note.content && (
                          <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">
                            {(note.content || '').replace(/<[^>]*>/g, '')}
                          </div>
                        )}
                        {note.tags && note.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                                {note.tags.map(tag => (
                                    <span key={tag} className="px-2 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-full">#{tag}</span>
                                ))}
                            </div>
                        )}
                      </div>
                      <div
                        className={`w-3 h-3 rounded-full ml-2 mt-1 flex-shrink-0 ${
                          note.color === 'bg-white' ? 'bg-gray-300' : note.color
                        }`}
                        title={note.color}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <div className="text-xs text-gray-600 dark:text-gray-400">
              <div className="truncate">Signed in as: {user.email}</div>
            </div>
          </div>
        </aside>
        <main className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900">
          {activeNote ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between mb-4">
                  <input
                    type="text" value={activeNote.title} onChange={handleTitleChange}
                    placeholder="Note Title"
                    className="text-2xl font-bold flex-1 bg-transparent focus:outline-none dark:text-gray-200 mr-4"
                  />
                  <button
                    onClick={() => deleteNote(activeNote.id)}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900 rounded-lg"
                    aria-label="Delete note"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Tags:</span>
                    {activeNote.tags?.map(tag => (
                        <div key={tag} className="flex items-center bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-semibold px-2.5 py-1 rounded-full">
                            <span>{tag}</span>
                            <button onClick={() => handleRemoveTag(tag)} className="ml-1.5 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    ))}
                    <input
                        type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                        placeholder="Add a tag..."
                        className="text-sm bg-gray-100 dark:bg-gray-700 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                   <button onClick={() => execCommand('bold')} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-600" title="Bold">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 4a1 1 0 011-1h3a3 3 0 110 6H6v2h3a3 3 0 110 6H6a1 1 0 01-1-1V4zm2 2v3h2a1 1 0 100-2H7zm0 5v3h3a1 1 0 100-2H7z" clipRule="evenodd" /></svg>
                  </button>
                  <button onClick={() => execCommand('italic')} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg italic text-sm hover:bg-gray-200 dark:hover:bg-gray-600" title="Italic">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8 2a1 1 0 000 2h1.5l-3 12H5a1 1 0 100 2h6a1 1 0 100-2h-1.5l3-12H14a1 1 0 100-2H8z" clipRule="evenodd" /></svg>
                  </button>
                  <button onClick={() => execCommand('underline')} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg underline text-sm hover:bg-gray-200 dark:hover:bg-gray-600" title="Underline">U</button>
                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                  <button onClick={() => execCommand('insertUnorderedList')} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600" title="Bullet List">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/></svg>
                  </button>
                  <button onClick={() => execCommand('insertOrderedList')} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600" title="Numbered List">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M1.5 7a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V7zM2 7h1v1H2V7zm0 3.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5H2zm1 .5H2v1h1v-1z"/></svg>
                  </button>
                  <button onClick={() => { if (!editorRef.current) return; const selection = window.getSelection(); const range = selection.getRangeAt(0); const checklistItem = document.createElement('div'); checklistItem.className = 'flex items-center mb-2 checklist-item'; checklistItem.innerHTML = `<input type="checkbox" class="mr-2 checklist-checkbox" /><span class="checklist-text" contenteditable="true">New item</span>`; range.insertNode(checklistItem); range.collapse(false); const textSpan = checklistItem.querySelector('.checklist-text'); textSpan.focus(); const textRange = document.createRange(); textRange.selectNodeContents(textSpan); selection.removeAllRanges(); selection.addRange(textRange); if (activeNote) { debouncedSaveNote({ ...activeNote, content: editorRef.current.innerHTML }); } }} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600" title="Add Checklist">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.071 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.235.235 0 0 1 .02-.022z" /></svg>
                  </button>
                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                  <div className="relative">
                    <button onClick={() => setShowColorPicker(!showColorPicker)} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600" title="Change Note Color">🎨</button>
                    {showColorPicker && ( <div className="absolute top-full left-0 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg mt-2 p-3 border"><div className="grid grid-cols-3 gap-2"> {[{ color: 'bg-white', name: 'White' }, { color: 'bg-yellow-100', name: 'Yellow' }, { color: 'bg-blue-100', name: 'Blue' }, { color: 'bg-green-100', name: 'Green' }, { color: 'bg-red-100', name: 'Red' }, { color: 'bg-purple-100', name: 'Purple' }, { color: 'bg-pink-100', name: 'Pink' }, { color: 'bg-orange-100', name: 'Orange' }, { color: 'bg-gray-100', name: 'Gray' }].map(({ color, name }) => ( <button key={color} className={`w-8 h-8 rounded-full border-2 ${ activeNote.color === color ? 'border-blue-500' : 'border-gray-300' } ${color} hover:scale-110`} onClick={() => handleColorChange(color)} title={name} /> ))} </div> </div> )}
                  </div>
                  <div className="relative">
                    <button onClick={() => setShowTextColorPicker(!showTextColorPicker)} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600" title="Change Text Color">🅣</button>
                    {showTextColorPicker && ( <div className="absolute top-full left-0 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg mt-2 p-3 border"><div className="flex items-center space-x-3"> <label className="text-xs">Text color</label> <input type="color" value={activeNote.textColor || '#111111'} onChange={(e) => handleTextColorChange(e.target.value)} className="w-8 h-8 rounded" /> <button className="px-2 py-1 text-xs bg-gray-100 rounded" onClick={() => handleTextColorChange(getAutoTextColor(activeNote.color || 'bg-white'))}>Auto</button> </div> </div> )}
                  </div>
                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                  <button onClick={handleGenerateRecipe} disabled={isLoading} className="px-3 py-2 bg-orange-500 text-white rounded-lg text-xs hover:bg-orange-600 shadow-sm disabled:bg-gray-400 flex items-center"><span className="mr-1">🍳</span>Recipe</button>
                  <button onClick={handlePlanItinerary} disabled={isLoading} className="px-3 py-2 bg-green-500 text-white rounded-lg text-xs hover:bg-green-600 shadow-sm disabled:bg-gray-400 flex items-center"><span className="mr-1">✈️</span>Itinerary</button>
                  <button onClick={toggleInviteModal} className="px-3 py-2 bg-purple-500 text-white rounded-lg text-xs hover:bg-purple-600 shadow-sm flex items-center" title="Share Note">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367-2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"/></svg>Share
                  </button>
                </div>
              </div>
              <div className="flex-1 p-6 overflow-y-auto">
                <div
                  className={`w-full max-w-4xl mx-auto rounded-xl p-6 shadow-sm min-h-full ${
                    activeNote.color === 'bg-white' ? 'bg-white dark:bg-gray-800' : activeNote.color
                  } ${activeNote.color !== 'bg-white' ? 'dark:opacity-90' : ''}`}
                >
                  <div
                    ref={editorRef}
                    className="w-full min-h-[600px] text-lg bg-transparent focus:outline-none note-content leading-relaxed"
                    contentEditable="true"
                    onInput={handleNoteChange}
                    onPaste={handlePaste}
                    style={{ color: activeNote.textColor || '#111111' }}
                    suppressContentEditableWarning={true}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-500 dark:text-gray-400 p-8">
              <div className="max-w-md">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mx-auto mb-6 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                <h3 className="text-xl font-semibold mb-2">Welcome to Synchronous Notes</h3>
                <p className="text-gray-400 dark:text-gray-500 mb-6">Select a note or create one to get started.</p>
                <button onClick={addNote} className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 font-medium"><svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>Create Your First Note</button>
              </div>
            </div>
          )}
        </main>
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-2xl max-w-md w-full dark:text-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Share Note</h3>
              <button onClick={toggleInviteModal} className="text-gray-400 hover:text-gray-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <p className="mb-4 text-gray-600 dark:text-gray-400">Invite a user to collaborate on this note.</p>
            <input type="email" className="w-full p-3 mb-4 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white" placeholder="collaborator@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            {message && ( <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900 border border-green-200 text-green-700 text-sm">{message}</div> )}
            <div className="flex justify-end space-x-3">
              <button onClick={toggleInviteModal} className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 rounded-lg hover:bg-gray-400">Cancel</button>
              <button onClick={handleInviteUser} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Send Invite</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .note-content { line-height: 1.6; }
        .note-content h1, .note-content h2, .note-content h3 { font-weight: bold; margin: 1rem 0 0.5rem 0; }
        .note-content h1 { font-size: 1.5rem; }
        .note-content h2 { font-size: 1.3rem; }
        .note-content h3 { font-size: 1.1rem; }
        .note-content ul, .note-content ol { margin: 0.5rem 0; padding-left: 1.5rem; }
        .note-content li { margin: 0.25rem 0; }
        .checklist-item { margin: 0.5rem 0; }
        .checklist-text { flex: 1; outline: none; }
        .recipe-section, .itinerary-section {
          background: rgba(59, 130, 246, 0.05);
          border-left: 4px solid #3b82f6;
          padding: 1rem;
          margin: 1rem 0;
          border-radius: 0.5rem;
        }
        .recipe-section h3, .itinerary-section h3 { color: #3b82f6; margin-top: 0; }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .checklist-checkbox:checked + .checklist-text {
          text-decoration: line-through;
          text-decoration-color: #ef4444;
          color: #9ca3af;
        }
      `}</style>
    </div>
  );
};

export default App;