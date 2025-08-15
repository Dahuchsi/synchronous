/* eslint-disable no-undef */
import { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, collection, setDoc, updateDoc, addDoc, deleteDoc, query, orderBy, where, getDoc, getDocs } from 'firebase/firestore';
import debounce from 'lodash.debounce';
import './tailwind.css';

// Read Firebase config from environment variables
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};
const initialAuthToken = '';
const appId = process.env.REACT_APP_FIREBASE_PROJECT_ID;

// Utility function to convert links to clickable anchor tags
function formatLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, (url) => `<a href="${url}" target="_blank" class="text-blue-500 hover:underline break-all">${url}</a>`);
}

// Custom hook to detect system dark mode preference
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

// Rich text formatting commands
const execCommand = (command, value = null) => {
  document.execCommand(command, false, value);
};

const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null);
  const [notes, setNotes] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [message, setMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginView, setIsLoginView] = useState(true);
  const editorRef = useRef(null);

  const prefersDarkMode = usePrefersDarkMode();

  // Initialize Firebase and Auth
  useEffect(() => {
    // Check for a valid Firebase config before initializing
    if (!firebaseConfig || !firebaseConfig.apiKey) {
      console.error("Firebase config is missing or invalid. App will not function correctly.");
      setIsAuthReady(true);
      return;
    }
    const app = initializeApp(firebaseConfig);
    const firestore = getFirestore(app);
    const firebaseAuth = getAuth(app);
    setDb(firestore);
    setAuth(firebaseAuth);

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setUserId(currentUser.uid);
      } else {
        setUserId(null);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, [firebaseConfig]);

  // Handle Dark Mode
  useEffect(() => {
    setIsDarkMode(prefersDarkMode);
  }, [prefersDarkMode]);

  // Apply dark mode class to HTML element
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Fetch and sync notes from Firestore
  useEffect(() => {
    if (!db || !userId) {
      setNotes([]);
      return;
    }

    const userNotesPath = `artifacts/${appId}/users/${userId}/notes`;
    const userNotesCollection = collection(db, userNotesPath);

    // Fetch user's own notes
    const unsubscribeOwnNotes = onSnapshot(userNotesCollection, (snapshot) => {
      const ownNotesList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setNotes(ownNotesList);
    });

    // TODO: Add logic to fetch shared notes here
    // This will require a public collection and a query for documents where the user's ID is a collaborator.

    return () => unsubscribeOwnNotes();
  }, [db, userId]);

  // Save changes to active note with debounce
  const debouncedSaveNote = useRef(
    debounce((updatedNote) => {
      if (!db || !userId) return;
      const noteRef = doc(db, `artifacts/${appId}/users/${userId}/notes`, updatedNote.id);
      updateDoc(noteRef, updatedNote).catch(console.error);
    }, 500)
  ).current;

  const handleNoteChange = (e) => {
    const content = e.target.innerHTML;
    const newNote = {
      ...activeNote,
      content,
    };
    setActiveNote(newNote);
    debouncedSaveNote(newNote);
  };

  const handleTitleChange = (e) => {
    const title = e.target.value;
    const newNote = {
      ...activeNote,
      title,
    };
    setActiveNote(newNote);
    debouncedSaveNote(newNote);
  };

  const addNote = async () => {
    if (!db || !userId) return;
    const newNote = {
      title: 'New Note',
      content: '',
      color: 'bg-white',
      collaborators: [],
      createdAt: new Date(),
    };
    try {
      const docRef = await addDoc(collection(db, `artifacts/${appId}/users/${userId}/notes`), newNote);
      setActiveNote({ ...newNote, id: docRef.id });
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  };

  const deleteNote = async (id) => {
    if (!db || !userId) return;
    try {
      await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/notes`, id));
      setActiveNote(null);
    } catch (e) {
      console.error("Error deleting document: ", e);
    }
  };

  const handleColorChange = (color) => {
    const newNote = { ...activeNote, color };
    setActiveNote(newNote);
    debouncedSaveNote(newNote);
  };

  const toggleInviteModal = () => {
    setShowInviteModal(!showInviteModal);
    setMessage(null);
    setInviteEmail('');
  };

  const handleInviteUser = async () => {
    if (!db || !userId || !activeNote) return;

    try {
      const publicNotesPath = `artifacts/${appId}/public/data/notes`;
      const noteRef = doc(db, publicNotesPath, activeNote.id);
      const updatedCollaborators = [...(activeNote.collaborators || []), inviteEmail];

      await setDoc(noteRef, { ...activeNote, collaborators: updatedCollaborators }, { merge: true });
      setMessage('Invite sent successfully! Note is now shared.');
    } catch (e) {
      console.error("Error sharing note: ", e);
      setMessage('Failed to send invite.');
    }
  };
  
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!auth) return;
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Login failed:", error);
      setMessage(`Login failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!auth) return;
    setIsLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Signup failed:", error);
      setMessage(`Signup failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    setActiveNote(null);
  };

  const callGeminiApi = async (prompt) => {
    const apiKey = ""; // Leave as empty string for the platform to provide the key
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }]
    };
    
    let delay = 1000;
    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) { // Too Many Requests
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                    continue;
                }
            }
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const result = await response.json();
            if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
              return result.candidates[0].content.parts[0].text;
            } else {
              throw new Error("Invalid API response format.");
            }
        } catch (error) {
            console.error("API call failed:", error);
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }
            throw error;
        }
    }
  };

  const handleGenerateRecipe = async () => {
    if (!activeNote) return;
    setIsLoading(true);
    setMessage('Generating recipe...');

    const prompt = `Based on the following list of ingredients, please generate a simple, delicious recipe. The recipe should include a title, a list of ingredients, and step-by-step instructions. Please format the response using Markdown.
    
    Ingredients: ${activeNote.content.replace(/<[^>]*>/g, '').trim()}`; // Remove HTML tags for clean prompt

    try {
      const generatedContent = await callGeminiApi(prompt);
      const newContent = `### Recipe: ${generatedContent}`;
      const updatedNote = { ...activeNote, content: activeNote.content + '<br/><br/>' + newContent };
      setActiveNote(updatedNote);
      debouncedSaveNote(updatedNote);
    } catch (error) {
      console.error("Error generating recipe:", error);
      setMessage('Failed to generate recipe. Please try again.');
    } finally {
      setIsLoading(false);
      setMessage(null);
    }
  };

  const handlePlanItinerary = async () => {
    if (!activeNote) return;
    setIsLoading(true);
    setMessage('Planning your itinerary...');

    const prompt = `Based on the following list of places, create a simple, day-by-day travel itinerary. Suggest a few activities for each location. Please format the response using Markdown with bold headings and bullet points.
    
    Locations: ${activeNote.content.replace(/<[^>]*>/g, '').trim()}`; // Remove HTML tags

    try {
      const generatedContent = await callGeminiApi(prompt);
      const newContent = `### Itinerary: ${generatedContent}`;
      const updatedNote = { ...activeNote, content: activeNote.content + '<br/><br/>' + newContent };
      setActiveNote(updatedNote);
      debouncedSaveNote(updatedNote);
    } catch (error) {
      console.error("Error planning itinerary:", error);
      setMessage('Failed to plan itinerary. Please try again.');
    } finally {
      setIsLoading(false);
      setMessage(null);
    }
  };


  // The main view for the app
  if (!isAuthReady) {
    return <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">Loading...</div>;
  }

  // Login/Signup view
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 font-sans">
        <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl w-full max-w-sm">
          <h2 className="text-3xl font-bold text-center mb-6 text-gray-800 dark:text-gray-200">
            {isLoginView ? 'Login' : 'Sign Up'}
          </h2>
          <form onSubmit={isLoginView ? handleLogin : handleSignup}>
            <div className="mb-4">
              <label className="block text-gray-700 dark:text-gray-300 mb-2" htmlFor="email">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="mb-6">
              <label className="block text-gray-700 dark:text-gray-300 mb-2" htmlFor="password">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                placeholder="••••••••"
                required
              />
            </div>
            {message && <p className="text-sm text-red-500 mb-4 text-center">{message}</p>}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full px-4 py-2 bg-blue-600 text-white font-bold rounded-lg shadow-md hover:bg-blue-700 transition-colors duration-300 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Processing...' : (isLoginView ? 'Login' : 'Sign Up')}
            </button>
          </form>
          <div className="text-center mt-4 text-sm text-gray-600 dark:text-gray-400">
            {isLoginView ? (
              <span>
                Don't have an account?{' '}
                <button onClick={() => setIsLoginView(false)} className="text-blue-500 hover:underline">
                  Sign up
                </button>
              </span>
            ) : (
              <span>
                Already have an account?{' '}
                <button onClick={() => setIsLoginView(true)} className="text-blue-500 hover:underline">
                  Login
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden font-sans">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 shadow-md">
        <h1 className="text-2xl font-bold">Synchronous Notes</h1>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm">Dark Mode</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                value=""
                className="sr-only peer"
                checked={isDarkMode}
                onChange={() => setIsDarkMode(!isDarkMode)}
              />
              <div className="w-11 h-6 bg-gray-400 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>
          <button
            onClick={addNote}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-colors duration-300"
          >
            New Note
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-600 text-white rounded-lg shadow-lg hover:bg-red-700 transition-colors duration-300"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar for Note List */}
        <aside className="w-1/4 p-4 bg-gray-100 dark:bg-gray-900 overflow-y-auto border-r border-gray-300 dark:border-gray-700">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">User ID: {user.uid}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">Email: {user.email}</div>
          <h2 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200">Your Notes</h2>
          {notes.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No notes yet. Create one!</p>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                onClick={() => setActiveNote(note)}
                className={`p-3 mb-2 rounded-lg cursor-pointer transition-transform transform hover:scale-105 shadow-sm ${note.color} ${activeNote?.id === note.id ? 'border-2 border-blue-500' : ''} dark:bg-gray-800 dark:text-gray-200`}
              >
                <div className="font-medium truncate">{note.title || 'Untitled'}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{new Date(note.createdAt?.seconds * 1000).toLocaleDateString()}</div>
              </div>
            ))
          )}
        </aside>

        {/* Note Editor */}
        <main className="flex-1 p-6 bg-gray-50 dark:bg-gray-950 overflow-y-auto flex flex-col items-center">
          {activeNote ? (
            <div className={`w-full max-w-2xl mx-auto rounded-xl p-6 shadow-2xl transition-all duration-300 ${activeNote.color === 'bg-white' ? 'bg-white' : activeNote.color} dark:bg-gray-800 dark:text-gray-200`}>
              <div className="flex justify-between items-center mb-4">
                <input
                  type="text"
                  value={activeNote.title}
                  onChange={handleTitleChange}
                  placeholder="Note Title"
                  className="text-3xl font-bold w-full p-2 bg-transparent focus:outline-none dark:text-gray-200"
                />
                <button
                  onClick={() => deleteNote(activeNote.id)}
                  className="p-2 text-red-500 hover:text-red-700 transition-colors duration-200 rounded-full"
                  aria-label="Delete note"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* Rich text toolbar */}
              <div className="flex items-center space-x-2 mb-4">
                <button
                  onClick={() => execCommand('bold')}
                  className="p-2 bg-gray-300 dark:bg-gray-700 rounded-lg font-bold text-sm hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors"
                >
                  B
                </button>
                <button
                  onClick={() => execCommand('insertUnorderedList')}
                  className="p-2 bg-gray-300 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
                    <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    const selection = window.getSelection();
                    if (!selection.isCollapsed) {
                      const range = selection.getRangeAt(0);
                      const selectedContent = range.extractContents();
                      const div = document.createElement('div');
                      div.className = "flex items-center mb-1";
                      div.innerHTML = `<input type="checkbox" class="mr-2" style="transform: scale(1.2);" /> <span contenteditable="true">${selectedContent.textContent}</span>`;
                      range.insertNode(div);
                      debouncedSaveNote({ ...activeNote, content: editorRef.current.innerHTML });
                    }
                  }}
                  className="p-2 bg-gray-300 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M10.97 4.97a.75.75 0 0 1 1.071 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.235.235 0 0 1 .02-.022z" />
                  </svg>
                  Checklist
                </button>
                {/* Color Palette */}
                <div className="relative group">
                  <button className="p-2 bg-gray-300 dark:bg-gray-700 rounded-lg text-sm hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
                      <path fillRule="evenodd" d="M1.5 10a.5.5 0 0 0 0 1h13a.5.5 0 0 0 0-1h-13zm0-3a.5.5 0 0 0 0 1h13a.5.5 0 0 0 0-1h-13zm0-3a.5.5 0 0 0 0 1h13a.5.5 0 0 0 0-1h-13z" />
                    </svg>
                    Color
                  </button>
                  <div className="absolute top-full left-0 z-10 hidden group-hover:block bg-white dark:bg-gray-800 rounded-lg shadow-lg mt-2 p-2">
                    {['bg-yellow-200', 'bg-blue-200', 'bg-green-200', 'bg-red-200', 'bg-purple-200', 'bg-white'].map((color) => (
                      <div
                        key={color}
                        className={`w-8 h-8 rounded-full cursor-pointer m-1 ${color} border-2 border-gray-400`}
                        onClick={() => handleColorChange(color)}
                      ></div>
                    ))}
                  </div>
                </div>
                {/* Invite Button */}
                <button
                  onClick={toggleInviteModal}
                  className="p-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition-colors shadow-md"
                >
                  Invite
                </button>
                {/* Gemini API Buttons */}
                <button
                  onClick={handleGenerateRecipe}
                  disabled={isLoading}
                  className="p-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Thinking...' : 'Generate Recipe ✨'}
                </button>
                <button
                  onClick={handlePlanItinerary}
                  disabled={isLoading}
                  className="p-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 transition-colors shadow-md disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Thinking...' : 'Plan Itinerary ✨'}
                </button>
              </div>

              {/* Editable Content Area */}
              <div
                ref={editorRef}
                className="w-full h-full min-h-[500px] p-4 text-lg bg-transparent focus:outline-none note-content dark:text-gray-200"
                contentEditable="true"
                dangerouslySetInnerHTML={{ __html: formatLinks(activeNote.content) }}
                onInput={handleNoteChange}
              ></div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4v16m8-8H4" />
              </svg>
              <p className="text-xl">Select a note from the left or create a new one to get started.</p>
            </div>
          )}
        </main>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-sm w-full transition-transform transform scale-100 dark:text-gray-200">
            <h3 className="text-xl font-bold mb-4">Share Note</h3>
            <p className="mb-4">Enter a user's ID to invite them to this note. The note will be made public.</p>
            <input
              type="text"
              className="w-full p-2 mb-4 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600"
              placeholder="User ID"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            {message && <p className="text-sm mb-4 text-green-500">{message}</p>}
            <div className="flex justify-end space-x-2">
              <button
                onClick={toggleInviteModal}
                className="px-4 py-2 bg-gray-300 dark:bg-gray-700 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInviteUser}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Invite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;