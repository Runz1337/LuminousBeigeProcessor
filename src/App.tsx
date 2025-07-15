import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, Auth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc, query, where, getDocs, Firestore, Unsubscribe } from 'firebase/firestore';
import { Upload, FileText, ChevronLeft, ChevronRight, Search, Zap, Highlighter, Type, MousePointer, Save, Trash2, ChevronsUpDown, Bot, X, LogIn, LogOut, Eraser, Plus, HelpCircle, ClipboardList, BookOpen, Edit, Flag, CheckCircle, XCircle, NotebookText, Menu, BookMarked, Bell } from 'lucide-react';
import { FaRegClock } from 'react-icons/fa';

// --- Type Definitions ---
interface HighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Annotation {
  id: string; // Firestore document ID
  type: 'highlight' | 'text'; // Extend as needed for other annotation types
  page: number;
  rects: HighlightRect[]; // For highlights, array of rectangles for multi-line selections
  color: string; // e.g., 'rgba(255, 255, 0, 0.3)'
  note: string; // User's note for the annotation
  text?: string; // The actual text that was highlighted
  originalZoom?: number;
}

interface AIResponseState {
  visible: boolean;
  content: string;
  isLoading: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  chatHistory: { role: 'user' | 'ai', text: string }[]; // For mini chat
  currentAiAction: 'explain' | 'summarize' | 'concepts' | 'ask_question' | 'auto_questions' | 'short_notes' | null;
}

// New interfaces for Quiz and Mistake Book
interface Question {
    no: number;
    question: string;
    options: string[];
    correct: number; // Index of the correct option (0-based)
    difficulty: 'easy' | 'medium' | 'hard'; // New: Difficulty tag
    explanation: string; // New: Explanation for the question
}

interface MistakeEntry {
    id?: string; // Firestore document ID
    page: number;
    question: string;
    wrongAnswer: string;
    correctAnswer: string;
    explanation: string;
    timestamp: string;
    context?: string; // New: Optional context from the PDF
    isUnattempted?: boolean; // New: Flag for unattempted questions
    isMarkedForReview?: boolean; // New: Flag for questions marked for review
    difficulty?: 'easy' | 'medium' | 'hard'; // New: Difficulty from the question
}

// New interface for Short Notes
interface ShortNoteEntry {
    id?: string; // Firestore document ID
    page: number;
    text: string; // The exact line from the PDF
    importanceTag: 'most important' | 'important' | 'can be forgotten';
    timestamp: string;
}

interface Notification {
    message: string;
    type: 'success' | 'error' | 'info';
    id: number; // Unique ID for each notification
}

// Declare global PDF.js library properties
declare global {
  interface Window {
    pdfjsLib: {
      GlobalWorkerOptions: {
        workerSrc: string;
      };
      getDocument: (data: { data: Uint8Array }) => {
        promise: Promise<PDFDocumentProxy>;
      };
      renderTextLayer: (params: {
        textContent: any;
        container: HTMLElement;
        viewport: any;
        textDivs: any[];
      }) => void;
      Util: {
        transform: (a: number[], b: number[]) => number[];
        applyTransform: (p: number[], m: number[]) => number[];
      };
    };
  }
}

// Basic types for PDF.js objects to avoid 'any' where possible
interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
}

interface PDFPageProxy {
  getViewport(params: { scale: number }): any;
  render(context: { canvasContext: CanvasRenderingContext2D; viewport: any }): { promise: Promise<void> };
  getTextContent(): Promise<any>;
}


// --- Firebase Configuration ---
const firebaseConfig = {   apiKey: "AIzaSyC0nM-Cji-nJezd7bAvZPHwDGs7jWOrEg4",   authDomain: "neon-equinox-337515.firebaseapp.com",   projectId: "neon-equinox-337515",   storageBucket: "neon-equinox-337515.firebasestorage.app",   messagingSenderId: "1055440875899",   appId: "1:1055440875899:web:71f697bed1467f4b704dde",   measurementId: "G-N1NJ0CGXT4" };
const appId =   'default-codex-app';
const initialAuthToken =   null;


// --- Custom Hook to load external scripts ---
const useScript = (url: string | null): 'idle' | 'loading' | 'ready' | 'error' => {
  const [status, setStatus] = useState< 'idle' | 'loading' | 'ready' | 'error' >(url ? "loading" : "idle");

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);

    if (!script) {
      script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.setAttribute("data-status", "loading");
      document.body.appendChild(script);

      const setAttributeFromEvent = (event: Event) => {
        script!.setAttribute("data-status", event.type === "load" ? "ready" : "error");
      };

      script.addEventListener("load", setAttributeFromEvent);
      script.addEventListener("error", setAttributeFromEvent);
    }

    const setStateFromEvent = (event: Event) => {
      setStatus(event.type === "load" ? "ready" : "error");
    };

    if (script.getAttribute("data-status") === "ready") {
        setStatus("ready");
    } else {
        script.addEventListener("load", setStateFromEvent);
        script.addEventListener("error", setStateFromEvent);
    }

    return () => {
      if (script) {
        script.removeEventListener("load", setStateFromEvent);
        script.removeEventListener("error", setStateFromEvent);
      }
    };
  }, [url]);

  return status;
};

// --- ColorPicker Component (New) ---
interface ColorPickerProps {
    color: string; // Expects rgba(r, g, b, a) or #RRGGBB
    onChange: (newColor: string) => void; // Returns rgba(r, g, b, a)
}

const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange }) => {
    const saturationLightnessCanvasRef = useRef<HTMLCanvasElement>(null);
    const hueSliderCanvasRef = useRef<HTMLCanvasElement>(null);
    const [h, setH] = useState(0); // Hue (0-360)
    const [s, setS] = useState(1); // Saturation (0-1)
    const [l, setL] = useState(0.5); // Lightness (0-1)
    const [a, setA] = useState(0.2); // Alpha (0-1)

    // Convert RGBA to HSL and update state when `color` prop changes
    useEffect(() => {
        const rgbaToHsl = (rgba: string) => {
            const parts = rgba.match(/\d+(\.\d+)?/g);
            if (!parts || parts.length < 3) return { h: 0, s: 1, l: 0.5, a: 1 }; // Default if invalid

            let r = parseInt(parts[0]) / 255;
            let g = parseInt(parts[1]) / 255;
            let b = parseInt(parts[2]) / 255;
            let alpha = parts.length === 4 ? parseFloat(parts[3]) : 1;

            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            let h = 0, s = 0, l = (max + min) / 2;

            if (max === min) {
                h = s = 0; // achromatic
            } else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                }
                h /= 6;
            }
            return { h: h * 360, s, l, a: alpha };
        };

        const hexToRgba = (hex: string, alpha: number) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        let rgbaColor = color;
        if (color.startsWith('#')) {
            rgbaColor = hexToRgba(color, a); // Assume current alpha if hex is provided
        }

        const { h: newH, s: newS, l: newL, a: newA } = rgbaToHsl(rgbaColor);
        setH(newH);
        setS(newS);
        setL(newL);
        setA(newA);
    }, [color]);

    // Convert HSL to RGBA string
    const hslToRgba = useCallback((h: number, s: number, l: number, a: number) => {
        h /= 360; // Normalize hue to [0, 1]
        let r, g, b;

        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1 / 6) return p + (q - p) * 6 * t;
                if (t < 1 / 2) return q;
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1 / 3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1 / 3);
        }

        return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    }, []);

    // Draw saturation/lightness canvas
    useEffect(() => {
        const canvas = saturationLightnessCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Background color based on current hue
        ctx.fillStyle = hslToRgba(h, 1, 0.5, 1); // Full saturation, mid lightness for hue base
        ctx.fillRect(0, 0, width, height);

        // Overlay for saturation (white to transparent)
        const whiteGradient = ctx.createLinearGradient(0, 0, width, 0);
        whiteGradient.addColorStop(0, 'rgba(255,255,255,1)');
        whiteGradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = whiteGradient;
        ctx.fillRect(0, 0, width, height);

        // Overlay for lightness (black to transparent)
        const blackGradient = ctx.createLinearGradient(0, 0, 0, height);
        blackGradient.addColorStop(0, 'rgba(0,0,0,0)');
        blackGradient.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = blackGradient;
        ctx.fillRect(0, 0, width, height);

        // Draw current color selector
        const x = s * width;
        const y = (1 - l) * height; // Invert lightness for y-axis
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.stroke();

    }, [h, s, l, hslToRgba]);

    // Draw hue slider canvas
    useEffect(() => {
        const canvas = hueSliderCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Create hue gradient
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        for (let i = 0; i <= 360; i += 60) {
            gradient.addColorStop(i / 360, `hsl(${i}, 100%, 50%)`);
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Draw hue selector
        const x = (h / 360) * width;
        ctx.beginPath();
        ctx.rect(x - 2, 0, 4, height);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.rect(x - 1.5, 0, 3, height);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }, [h]);

    // Update parent component's color when HSL or Alpha changes
    useEffect(() => {
        onChange(hslToRgba(h, s, l, a));
    }, [h, s, l, a, onChange, hslToRgba]);

    // Mouse event handlers for saturation/lightness picker
    const handleSaturationLightnessMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = saturationLightnessCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const updateColor = (clientX: number, clientY: number) => {
            let newS = (clientX - rect.left) / rect.width;
            let newL = 1 - ((clientY - rect.top) / rect.height); // Invert lightness
            newS = Math.max(0, Math.min(1, newS));
            newL = Math.max(0, Math.min(1, newL));
            setS(newS);
            setL(newL);
        };
        updateColor(e.clientX, e.clientY);

        const onMouseMove = (moveEvent: MouseEvent) => updateColor(moveEvent.clientX, moveEvent.clientY);
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    // Mouse event handlers for hue slider
    const handleHueSliderMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = hueSliderCanvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const updateHue = (clientX: number) => {
            let newH = ((clientX - rect.left) / rect.width) * 360;
            newH = Math.max(0, Math.min(360, newH));
            setH(newH);
        };
        updateHue(e.clientX);

        const onMouseMove = (moveEvent: MouseEvent) => updateHue(moveEvent.clientX);
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    const handleAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setA(parseFloat(e.target.value));
    };

    return (
        <div className="flex flex-col items-center p-1.5 bg-gray-50 rounded-md border border-gray-100 shadow-inner">
            <canvas
                ref={saturationLightnessCanvasRef}
                width="150"
                height="100"
                className="rounded-md border border-gray-200 cursor-crosshair mb-2"
                onMouseDown={handleSaturationLightnessMouseDown}
            ></canvas>
            <canvas
                ref={hueSliderCanvasRef}
                width="150"
                height="15"
                className="rounded-md border border-gray-200 cursor-ew-resize mb-2"
                onMouseDown={handleHueSliderMouseDown}
            ></canvas>
            <div className="w-full flex items-center space-x-1 text-xs text-gray-700 mb-1">
                <label htmlFor="alpha-slider" className="whitespace-nowrap">Opacity:</label>
                <input
                    type="range"
                    id="alpha-slider"
                    min="0"
                    max="1"
                    step="0.01"
                    value={a}
                    onChange={handleAlphaChange}
                    className="flex-grow h-1.5 rounded-lg appearance-none cursor-pointer bg-gray-200"
                    style={{ background: `linear-gradient(to right, transparent, ${hslToRgba(h, s, l, 1)})` }}
                />
                <span className="w-8 text-right">{Math.round(a * 100)}%</span>
            </div>
            <div className="w-full text-center text-xs text-gray-600 font-mono">
                {color.startsWith('#') ? color.substring(0, 7) : color}
            </div>
        </div>
    );
};


// --- Main App Component ---
export default function App(): JSX.Element {
    // --- Script Loading State ---
    const pdfJsStatus = useScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.min.js');

    // --- State Management ---
    // Firebase authentication and database states
    const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [db, setDb] = useState<Firestore | null>(null);
    const [auth, setAuth] = useState<Auth | null>(null);

    // PDF document states
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [totalPages, setTotalPages] = useState<number>(0);
    const [zoom, setZoom] = useState<number>(1);

    // Annotation states
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
    const [selectedTool, setSelectedTool] = useState<'select' | 'highlight' | 'erase' | 'note'>('select');
    const [highlightColor, setHighlightColor] = useState<string>('rgba(255, 255, 0, 0.2)'); // Default yellow with lower opacity

    // Context menu and text selection states
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [selectedText, setSelectedText] = useState<string>('');

    // AI response window states
    const [aiResponse, setAiResponse] = useState<AIResponseState>({ visible: false, content: '', isLoading: false, position: { x: 200, y: 200 }, size: { width: 400, height: 300 }, chatHistory: [], currentAiAction: null });
    const [aiModel, setAiModel] = useState<string>('mistral'); // Variable for AI model

    // Quiz states
    const [quizQuestions, setQuizQuestions] = useState<Question[]>([]);
    const [showQuiz, setShowQuiz] = useState<boolean>(false);
    const [userAnswers, setUserAnswers] = useState<{ [questionNo: number]: number | null }>({});
    const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);
    const [score, setScore] = useState<number | null>(null);
    const [showQuizResults, setShowQuizResults] = useState<boolean>(false);
    const [currentQuizQuestionIndex, setCurrentQuizQuestionIndex] = useState(0);
    const [numQuestions, setNumQuestions] = useState<number>(10);

    // Mistake Book states
    const [mistakeBook, setMistakeBook] = useState<MistakeEntry[]>([]);
    const [showMistakeBook, setShowMistakeBook] = useState<boolean>(false);
    const [showMistakeEditor, setShowMistakeEditor] = useState<boolean>(false);
    const [currentMistakeToEdit, setCurrentMistakeToEdit] = useState<MistakeEntry | null>(null);

    // Short Notes states
    const [shortNotes, setShortNotes] = useState<ShortNoteEntry[]>([]);
    const [showShortNotesUI, setShowShortNotesUI] = useState<boolean>(false);
    const [shortNotesRegenPrompt, setShortNotesRegenPrompt] = useState<string>('');

    // Help modal state
    const [showHelpModal, setShowHelpModal] = useState<boolean>(false);

    // UI state for loading overlay and notifications
    const [showLoadingOverlay, setShowLoadingOverlay] = useState<boolean>(false);
    const [notification, setNotification] = useState<Notification | null>(null);
    const notificationTimeoutRef = useRef<number | null>(null);

    // Tool Palette visibility state
    const [isToolPaletteOpen, setIsToolPaletteOpen] = useState(false);

    // Sidebar state
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

    // Timer states (NEW)
    const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now()); // Timestamp when session started/resumed
    const [totalTimeSpent, setTotalTimeSpent] = useState<number>(0); // Total time spent on website (persisted)
    const [currentSessionElapsed, setCurrentSessionElapsed] = useState<number>(0); // Time elapsed in current session (not persisted)
    const timerIntervalRef = useRef<number | null>(null);
    const isSavingTimeRef = useRef<boolean>(false); // To prevent multiple saves on unmount/signout

    // Refs for DOM elements
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pdfViewerRef = useRef<HTMLDivElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const annotationLayerRef = useRef<HTMLDivElement>(null);
    const annotationsUnsubscribe = useRef<Unsubscribe | null>(null);
    const mistakesUnsubscribe = useRef<Unsubscribe | null>(null);
    const shortNotesUnsubscribe = useRef<Unsubscribe | null>(null);
    const toolPaletteRef = useRef<HTMLDivElement>(null);


    // --- Firebase Initialization and Auth ---
    useEffect(() => {
        if (Object.keys(firebaseConfig).length > 0) {
            try {
                const app: FirebaseApp = initializeApp(firebaseConfig);
                const authInstance: Auth = getAuth(app);
                const dbInstance: Firestore = getFirestore(app);
                setAuth(authInstance);
                setDb(dbInstance);

                const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                    if (user) {
                        setUserId(user.uid);
                        setIsAuthReady(true);
                    } else {
                        try {
                            if (initialAuthToken) {
                                await signInWithCustomToken(authInstance, initialAuthToken);
                            } else {
                                await signInAnonymously(authInstance);
                            }
                        } catch (error) {
                            console.error("Authentication failed during sign-in:", error);
                        }
                    }
                });
                return () => unsubscribe();
            } catch (initError) {
                console.error("Firebase initialization failed:", initError);
            }
        } else {
            console.warn("Firebase config is empty. Please set REACT_APP_FIREBASE_CONFIG secret.");
        }
    }, []);

    // --- Timer Logic (NEW) ---
    useEffect(() => {
        if (!db || !userId) return;

        // Function to load time spent
        const loadTimeSpent = async () => {
            try {
                const timeDocRef = doc(db, `artifacts/${appId}/users/${userId}/sessionTime`, 'total');
                const docSnap = await getDoc(timeDocRef);
                if (docSnap.exists()) {
                    setTotalTimeSpent(docSnap.data().totalSeconds || 0);
                } else {
                    setTotalTimeSpent(0);
                }
            } catch (error) {
                console.error("Error loading total time spent:", error);
            }
        };

        loadTimeSpent();

        // Start the timer
        setSessionStartTime(Date.now()); // Reset start time for the new session
        setCurrentSessionElapsed(0); // Reset current session elapsed time

        timerIntervalRef.current = window.setInterval(() => {
            setCurrentSessionElapsed(prev => prev + 1);
        }, 1000);

        // Cleanup function for timer and saving on unmount
        return () => {
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
            }
            // Save time when component unmounts or userId changes
            const saveTimeOnUnload = async () => {
                if (db && userId && currentSessionElapsed > 0 && !isSavingTimeRef.current) {
                    isSavingTimeRef.current = true; // Set flag to prevent multiple saves
                    try {
                        const timeDocRef = doc(db, `artifacts/${appId}/users/${userId}/sessionTime`, 'total');
                        const docSnap = await getDoc(timeDocRef);
                        const existingTotal = docSnap.exists() ? docSnap.data().totalSeconds : 0;
                        await setDoc(timeDocRef, { totalSeconds: existingTotal + currentSessionElapsed }, { merge: true });
                        console.log(`Saved ${currentSessionElapsed} seconds. New total: ${existingTotal + currentSessionElapsed}`);
                    } catch (error) {
                        console.error("Error saving time on unload:", error);
                    } finally {
                        isSavingTimeRef.current = false; // Reset flag
                    }
                }
            };

            // Add event listener for beforeunload to save time when tab/browser closes
            window.addEventListener('beforeunload', saveTimeOnUnload);

            return () => {
                window.removeEventListener('beforeunload', saveTimeOnUnload);
                saveTimeOnUnload(); // Also call on component unmount
            };
        };
    }, [db, userId, appId]); // Re-run when db or userId changes

    // --- PDF Rendering Logic ---
    const renderPage = useCallback(async (pageNumber: number, docToRender: PDFDocumentProxy) => {
        if (!docToRender || pdfJsStatus !== 'ready') return;
        try {
            const page = await docToRender.getPage(pageNumber);
            const viewport = page.getViewport({ scale: zoom });

            const canvas = canvasRef.current;
            if (!canvas) return;
            const context = canvas.getContext('2d');
            if (!context) return;

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport,
            };
            await page.render(renderContext).promise;

            const textContent = await page.getTextContent();
            const textLayer = textLayerRef.current;
            if (!textLayer) return;
            textLayer.innerHTML = '';
            textLayer.style.width = `${canvas.width}px`;
            textLayer.style.height = `${canvas.height}px`;
            textLayer.style.pointerEvents = (selectedTool === 'highlight' || selectedTool === 'select' || selectedTool === 'note') ? 'auto' : 'none';


            if (window.pdfjsLib && window.pdfjsLib.renderTextLayer) {
                window.pdfjsLib.renderTextLayer({
                    textContent,
                    container: textLayer,
                    viewport,
                    textDivs: []
                });
            } else {
                console.warn("pdfjsLib.renderTextLayer is not available.");
            }

        } catch (error) {
            console.error('Error rendering page:', error);
        }
    }, [zoom, pdfJsStatus, selectedTool]);

    // --- Load PDF and Annotations/Mistakes/ShortNotes ---
    useEffect(() => {
        if (pdfFile && db && userId && pdfJsStatus === 'ready') {
            const reader = new FileReader();
            reader.onload = async (e: ProgressEvent<FileReader>) => {
                const arrayBuffer = e.target?.result as ArrayBuffer;
                if (!arrayBuffer) {
                    console.error("Failed to read file as ArrayBuffer.");
                    return;
                }
                const pdfData = new Uint8Array(arrayBuffer);

                if (window.pdfjsLib) {
                    try {
                        const workerResponse = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js');
                        if (!workerResponse.ok) {
                            throw new Error('Failed to fetch PDF.js worker script.');
                        }
                        const workerBlob = new Blob([await workerResponse.text()], { type: 'application/javascript' });
                        const workerBlobUrl = URL.createObjectURL(workerBlob);
                        window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerBlobUrl;

                        const loadingTask = window.pdfjsLib.getDocument({ data: pdfData });
                        const pdfDocument: PDFDocumentProxy = await loadingTask.promise;
                        setPdfDoc(pdfDocument);
                        setTotalPages(pdfDocument.numPages);
                        setCurrentPage(1);

                        const docRef = doc(db, `artifacts/${appId}/users/${userId}/documents`, pdfFile.name);
                        const docSnap = await getDoc(docRef);
                        if (!docSnap.exists()) {
                            await setDoc(docRef, { name: pdfFile.name, createdAt: new Date().toISOString() });
                        }

                        if (annotationsUnsubscribe.current) annotationsUnsubscribe.current();
                        const annotationsCol = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/annotations`);
                        annotationsUnsubscribe.current = onSnapshot(annotationsCol, (snapshot) => {
                            const loadedAnnotations: Annotation[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Annotation));
                            setAnnotations(loadedAnnotations);
                        });

                        if (mistakesUnsubscribe.current) mistakesUnsubscribe.current();
                        const mistakesCol = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/mistakes`);
                        mistakesUnsubscribe.current = onSnapshot(mistakesCol, (snapshot) => {
                            const loadedMistakes: MistakeEntry[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as MistakeEntry));
                            setMistakeBook(loadedMistakes);
                        });

                        if (shortNotesUnsubscribe.current) shortNotesUnsubscribe.current();
                        const shortNotesCol = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/shortNotes`);
                        shortNotesUnsubscribe.current = onSnapshot(shortNotesCol, (snapshot) => {
                            const loadedShortNotes: ShortNoteEntry[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ShortNoteEntry));
                            setShortNotes(loadedShortNotes);
                        });

                    } catch (error) {
                        console.error("Error loading PDF document:", error);
                        console.error("Failed to load PDF. The file might be corrupted or protected.");
                        setPdfFile(null);
                    }
                } else {
                    console.error("pdf.js is not loaded, though status was ready.");
                }
            };
            reader.readAsArrayBuffer(pdfFile);
        }
        return () => {
            if (annotationsUnsubscribe.current) {
                annotationsUnsubscribe.current();
                annotationsUnsubscribe.current = null;
            }
            if (mistakesUnsubscribe.current) {
                mistakesUnsubscribe.current();
                mistakesUnsubscribe.current = null;
            }
            if (shortNotesUnsubscribe.current) {
                shortNotesUnsubscribe.current();
                shortNotesUnsubscribe.current = null;
            }
        };
    }, [pdfFile, db, userId, pdfJsStatus, appId]);

    // --- Render page when current page or PDF doc changes ---
    useEffect(() => {
        if (pdfDoc && pdfJsStatus === 'ready') {
            renderPage(currentPage, pdfDoc);
        }
    }, [pdfDoc, currentPage, renderPage, pdfJsStatus]);

    // --- Event Handlers ---
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            setPdfFile(file);
            setQuizQuestions([]);
            setShowQuiz(false);
            setUserAnswers({});
            setQuizSubmitted(false);
            setScore(null);
            setMistakeBook([]);
            setShowMistakeBook(false);
            setShowQuizResults(false);
            setCurrentQuizQuestionIndex(0);
            setShortNotes([]);
            setShowShortNotesUI(false);
        } else {
            console.error('Please select a PDF file.');
            setPdfFile(null);
        }
    };

    const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>): void => {
        if (!pdfViewerRef.current || !textLayerRef.current) return;

        const selection = window.getSelection();
        const selectedString = selection?.toString().trim() || '';

        if (selectedTool === 'highlight') {
            if (selectedString) {
                if (!selection || selection.rangeCount === 0) return;

                const range = selection.getRangeAt(0);
                const viewerRect = pdfViewerRef.current.getBoundingClientRect();
                const rects: HighlightRect[] = Array.from(range.getClientRects()).map(rect => {
                    return {
                        x: rect.left - viewerRect.left,
                        y: rect.top - viewerRect.top,
                        width: rect.width,
                        height: rect.height,
                    };
                });

                addAnnotation({
                    type: 'highlight',
                    page: currentPage,
                    rects: rects,
                    color: highlightColor,
                    note: '',
                    text: selectedString,
                    originalZoom: zoom
                });
                if (selection) {
                    selection.removeAllRanges();
                }
            }
        } else if (selectedTool === 'select') {
            setSelectedText(selectedString);
        } else if (selectedTool === 'note') {
            if (selectedString) {
                addAnnotation({
                    type: 'text',
                    page: currentPage,
                    rects: [],
                    color: '',
                    note: selectedString,
                    text: selectedString,
                    originalZoom: zoom
                });
                if (selection) {
                    selection.removeAllRanges();
                }
                setSelectedText('');
            }
        } else {
            setSelectedText('');
            if (selection) {
                selection.removeAllRanges();
            }
        }
    };

    const handleAnnotationClick = (ann: Annotation) => {
        if (selectedTool === 'erase') {
            deleteAnnotation(ann.id);
        } else {
            setActiveAnnotation(ann);
        }
    };

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
        e.preventDefault();
        if (!textLayerRef.current?.contains(e.target as Node)) {
            setContextMenu(null);
            return;
        }
        const selection = window.getSelection()?.toString().trim();
        if (selection) {
            setSelectedText(selection);
            setContextMenu({ x: e.clientX, y: e.clientY });
        } else {
            setContextMenu(null);
        }
    };

    // --- Firestore Operations ---
    const addAnnotation = async (annotation: Omit<Annotation, 'id'>): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot add annotation: DB, userId, or pdfFile not ready.");
            return;
        }
        try {
            const annotationsCol = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/annotations`);
            await addDoc(annotationsCol, annotation);
            setNotification({ message: "Annotation added successfully!", type: "success", id: Date.now() });
        } catch (error) {
            console.error("Error adding annotation:", error);
            setNotification({ message: "Failed to add annotation.", type: "error", id: Date.now() });
        }
    };

    const updateAnnotationNote = async (id: string, note: string): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot update annotation: DB, userId, or pdfFile not ready.");
            return;
        }
        const annotationRef = doc(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/annotations`, id);
        try {
            await updateDoc(annotationRef, { note });
            setNotification({ message: "Annotation note updated successfully!", type: "success", id: Date.now() });
        } catch (error) {
            console.error("Error updating annotation note:", error);
            setNotification({ message: "Failed to update annotation note.", type: "error", id: Date.now() });
        }
    };

    const deleteAnnotation = async (id: string): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot delete annotation: DB, userId, or pdfFile not ready.");
            return;
        }
        const annotationRef = doc(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/annotations`, id);
        try {
            await deleteDoc(annotationRef);
            setNotification({ message: "Annotation deleted successfully!", type: "success", id: Date.now() });
            if (activeAnnotation?.id === id) {
                setActiveAnnotation(null);
            }
        } catch (error) {
            console.error("Error deleting annotation:", error);
            setNotification({ message: "Failed to delete annotation.", type: "error", id: Date.now() });
        }
    };

    const saveMistake = async (mistake: Omit<MistakeEntry, 'id'> | MistakeEntry): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot save mistake: DB, userId, or pdfFile not ready.");
            return;
        }
        try {
            const mistakesCol = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/mistakes`);
            if (mistake.id) {
                const mistakeRef = doc(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/mistakes`, mistake.id);
                await setDoc(mistakeRef, mistake, { merge: true });
                setNotification({ message: "Mistake updated successfully!", type: "success", id: Date.now() });
            } else {
                await addDoc(mistakesCol, { ...mistake, timestamp: new Date().toISOString() });
                setNotification({ message: "Mistake added successfully!", type: "success", id: Date.now() });
            }
        } catch (error) {
            console.error("Error saving mistake:", error);
            setNotification({ message: "Failed to save mistake.", type: "error", id: Date.now() });
        }
    };

    const deleteMistake = async (id: string): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot delete mistake: DB, userId, or pdfFile not ready.");
            return;
        }
        const mistakeRef = doc(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/mistakes`, id);
        try {
            await deleteDoc(mistakeRef);
            setNotification({ message: "Mistake deleted successfully!", type: "success", id: Date.now() });
        } catch (error) {
            console.error("Error deleting mistake:", error);
            setNotification({ message: "Failed to delete mistake.", type: "error", id: Date.now() });
        }
    };

    const saveShortNote = async (note: Omit<ShortNoteEntry, 'id'>): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot save short note: DB, userId, or pdfFile not ready.");
            return;
        }
        try {
            const shortNotesCol = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/shortNotes`);
            await addDoc(shortNotesCol, { ...note, timestamp: new Date().toISOString() });
            setNotification({ message: "Short note added successfully!", type: "success", id: Date.now() });
        } catch (error) {
            console.error("Error saving short note:", error);
            setNotification({ message: "Failed to save short note.", type: "error", id: Date.now() });
        }
    };

    const deleteShortNote = async (id: string): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot delete short note: DB, userId, or pdfFile not ready.");
            return;
        }
        const noteRef = doc(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/shortNotes`, id);
        try {
            await deleteDoc(noteRef);
            setNotification({ message: "Short note deleted successfully!", type: "success", id: Date.now() });
        } catch (error) {
            console.error("Error deleting short note:", error);
            setNotification({ message: "Failed to delete short note.", type: "error", id: Date.now() });
        }
    };

    const deleteAllShortNotesForPage = async (pageNumber: number): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot delete short notes: DB, userId, or pdfFile not ready.");
            return;
        }
        try {
            const shortNotesColRef = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/shortNotes`);
            const q = query(shortNotesColRef, where("page", "==", pageNumber));
            const querySnapshot = await getDocs(q);

            const deletePromises: Promise<void>[] = [];
            querySnapshot.forEach((doc) => {
                deletePromises.push(deleteDoc(doc.ref));
            });
            await Promise.all(deletePromises);
            setNotification({ message: `All short notes for page ${pageNumber} deleted.`, type: "info", id: Date.now() });
        } catch (error) {
            console.error(`Error deleting short notes for page ${pageNumber}:`, error);
            setNotification({ message: `Failed to delete short notes for page ${pageNumber}.`, type: "error", id: Date.now() });
        }
    };


    const getColorWithOpacity = (colorName: string, opacity: number): string => {
        const colors: { [key: string]: string } = {
            red: '255, 0, 0',
            blue: '0, 0, 255',
            green: '0, 128, 0',
            yellow: '255, 255, 0',
            purple: '128, 0, 128',
            orange: '255, 165, 0',
            cyan: '0, 255, 255',
        };
        const lowerCaseColorName = colorName.toLowerCase();
        const rgb = colors[lowerCaseColorName];

        if (!rgb) {
            console.warn(`Unknown color name received from AI: "${colorName}". Defaulting to gray.`);
            return `rgba(128, 128, 128, ${opacity})`;
        }
        return `rgba(${rgb}, ${opacity})`;
    };

    function createRegexFromStatement(statement: string): RegExp {
        const escaped = statement.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const pattern = escaped.replace(/\s+/g, '\\s+');
        return new RegExp(pattern, 'i');
    }

    const parseJsonResponse = (rawText: string): any | null => {
        try {
            let jsonMatch = rawText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                return JSON.parse(jsonMatch[1]);
            }

            jsonMatch = rawText.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                return JSON.parse(jsonMatch[1]);
            }

            const trimmedText = rawText.trim();
            if ((trimmedText.startsWith('{') && trimmedText.endsWith('}')) || (trimmedText.startsWith('[') && trimmedText.endsWith(']'))) {
                return JSON.parse(trimmedText);
            }

            try {
                const outerParsed = JSON.parse(trimmedText);
                if (outerParsed && typeof outerParsed === 'object') {
                    if (outerParsed.json !== undefined) {
                        return outerParsed.json;
                    }
                    if (outerParsed.contents !== undefined) {
                        return outerParsed.contents;
                    }
                }
            } catch (e) {
                // Continue to next attempts if this parsing fails
            }
            return null;

        } catch (error) {
            console.error("Error during robust JSON parsing:", error, "Raw text:", rawText);
            return null;
        }
    };


    // --- AI Integration ---
    const highlightConcepts = useCallback(async (concepts: { [color: string]: string[] }) => {
        if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;

        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale: zoom });

        const textLayer = textLayerRef.current;
        if (!textLayer) {
            console.warn("Text layer not available for highlighting.");
            return;
        }

        let fullPageText = '';
        const textNodeMap: { node: Text; start: number; end: number; originalSpan: HTMLSpanElement; rect: DOMRect }[] = [];
        let currentOffset = 0;
        let prevSpanBottom = 0;

        for (let i = 0; i < textLayer.children.length; i++) {
            const span = textLayer.children[i] as HTMLSpanElement;
            if (span.firstChild && span.firstChild.nodeType === Node.TEXT_NODE) {
                const textNode = span.firstChild as Text;
                const text = textNode.textContent || '';
                if (text.trim().length > 0) {
                    const spanRect = span.getBoundingClientRect();
                    if (prevSpanBottom !== 0 && spanRect.top > prevSpanBottom + (spanRect.height * 0.5)) {
                        fullPageText += '\n';
                        currentOffset += 1;
                    }
                    const start = currentOffset;
                    fullPageText += text;
                    currentOffset += text.length;
                    fullPageText += ' ';
                    currentOffset += 1;
                    textNodeMap.push({
                        node: textNode,
                        start: start,
                        end: start + text.length,
                        originalSpan: span,
                        rect: spanRect
                    });
                    prevSpanBottom = spanRect.bottom;
                }
            }
        }
        fullPageText = fullPageText.trim();

        for (const colorName in concepts) {
            if (concepts.hasOwnProperty(colorName)) {
                const statements = concepts[colorName];
                if (!Array.isArray(statements)) {
                    console.warn(`Expected an array for color "${colorName}", but received:`, statements);
                    continue;
                }
                const highlightRGBAColor = getColorWithOpacity(colorName, 0.2);
                for (const statement of statements) {
                    const regex = createRegexFromStatement(statement);
                    const match = fullPageText.match(regex);
                    if (match) {
                        const matchStartIndex = match.index!;
                        const matchEndIndex = matchStartIndex + match[0].length;
                        let foundRects: HighlightRect[] = [];
                        const viewerRect = pdfViewerRef.current!.getBoundingClientRect();
                        for (const nodeInfo of textNodeMap) {
                            const nodeOverlapStart = Math.max(nodeInfo.start, matchStartIndex);
                            const nodeOverlapEnd = Math.min(nodeInfo.end, matchEndIndex);
                            if (nodeOverlapStart < nodeOverlapEnd) {
                                const range = document.createRange();
                                const startOffsetInNode = nodeOverlapStart - nodeInfo.start;
                                const endOffsetInNode = nodeOverlapEnd - nodeInfo.start;
                                if (startOffsetInNode < 0 || endOffsetInNode > nodeInfo.node.length || startOffsetInNode > endOffsetInNode) {
                                    continue;
                                }
                                try {
                                    range.setStart(nodeInfo.node, startOffsetInNode);
                                    range.setEnd(nodeInfo.node, endOffsetInNode);
                                    const clientRects = range.getClientRects();
                                    for (let j = 0; j < clientRects.length; j++) {
                                        const rect = clientRects[j];
                                        foundRects.push({
                                            x: rect.left - viewerRect.left,
                                            y: rect.top - viewerRect.top,
                                            width: rect.width,
                                            height: rect.height,
                                        });
                                    }
                                } catch (e) {
                                    console.error("Error creating range for highlight:", e, "Node text:", nodeInfo.node.textContent, "Offsets:", startOffsetInNode, endOffsetInNode);
                                }
                            }
                        }
                        let filteredRects: HighlightRect[] = [];
                        if (foundRects.length > 0) {
                            foundRects.sort((a, b) => a.y - b.y);
                            filteredRects.push(foundRects[0]);
                            const averageHeight = foundRects.reduce((sum, r) => sum + r.height, 0) / foundRects.length;
                            const maxVerticalGap = averageHeight * 1.5;
                            for (let k = 1; k < foundRects.length; k++) {
                                const prevRect = filteredRects[filteredRects.length - 1];
                                const currentRect = foundRects[k];
                                if (currentRect.y < prevRect.y + maxVerticalGap) {
                                    filteredRects.push(currentRect);
                                } else {
                                    break;
                                }
                            }
                        }
                        if (filteredRects.length > 0) {
                            const isDuplicate = annotations.some(ann =>
                                ann.page === currentPage &&
                                ann.type === 'highlight' &&
                                ann.text && ann.text === statement
                            );
                            if (!isDuplicate) {
                                addAnnotation({
                                    type: 'highlight',
                                    page: currentPage,
                                    rects: filteredRects,
                                    color: highlightRGBAColor,
                                    note: `AI identified concept: "${statement}"`,
                                    text: statement,
                                    originalZoom: zoom
                                });
                            }
                        }
                    }
                }
            }
        }
    }, [pdfDoc, currentPage, zoom, addAnnotation, getColorWithOpacity, annotations]);


    const handleAiAction = async (action: 'explain' | 'summarize' | 'concepts' | 'ask_question' | 'auto_questions' | 'short_notes', query?: string): Promise<void> => {
        setContextMenu(null);

        let textToProcess: string = selectedText;

        if ((action === 'concepts' || action === 'auto_questions' || action === 'short_notes') && pdfDoc) {
            try {
                const page = await pdfDoc.getPage(currentPage);
                const textContent = await page.getTextContent();
                textToProcess = textContent.items.map((item: any) => item.str).join(' ').replace(/\s+/g, ' ').trim();
            } catch (error) {
                console.error("Error fetching full page text for AI analysis:", error);
                setNotification({ message: "Error fetching page text for AI analysis.", type: "error", id: Date.now() });
                return;
            }
        }

        if (!textToProcess && action !== 'ask_question') {
            setNotification({ message: "Please select text or load a PDF to use this AI feature.", type: "info", id: Date.now() });
            return;
        }

        if (action === 'short_notes') {
            const existingNotes = shortNotes.filter(n => n.page === currentPage);
            if (existingNotes.length > 0) {
                setNotification({ message: "Short notes for this page already exist. Displaying them.", type: "info", id: Date.now() });
                setShowShortNotesUI(true);
                return;
            }
        }

        let promptForLLM: string;
        let newChatHistory: { role: 'user' | 'ai', text: string }[] = [];
        let apiUrl: string;
        let fetchMethod: 'GET' = 'GET';
        let headers: HeadersInit = {};

        const pollinaionsBaseUrl = `https://text.pollinations.ai/`;

        if (action === 'ask_question' && !query) {
            newChatHistory = [{ role: 'user', text: `I've selected the following text:\n\n"${textToProcess}"` }];
            setAiResponse(prev => ({
                ...prev,
                visible: true,
                isLoading: false,
                content: "Please type your question about the selected text below.",
                chatHistory: newChatHistory,
                currentAiAction: action
            }));
            return;
        }

        if (query) {
            newChatHistory = [...aiResponse.chatHistory, { role: 'user', text: query }];
            if (aiResponse.currentAiAction === 'ask_question') {
                const initialTextContext = aiResponse.chatHistory[0]?.text || '';
                promptForLLM = `Given the following text: "${initialTextContext}" and the conversation history:\n\n${newChatHistory.slice(0, -1).map(h => `${h.role}: ${h.text}`).join('\n')}\n\nUser's question: "${query}"\n\nPlease answer the user's question based *only* on the provided text.`;
            } else {
                promptForLLM = newChatHistory.map(h => `${h.role}: ${h.text}`).join('\n\n');
            }
            apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=${aiModel}`;
        } else {
            switch (action) {
                case 'explain':
                    promptForLLM = `Explain the following text in a concise and easy-to-understand way: "${textToProcess}"`;
                    apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=${aiModel}`;
                    break;
                case 'summarize':
                    promptForLLM = `Summarize this passage: "${textToProcess}"`;
                    apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=${aiModel}`;
                    break;
                case 'concepts':
                    promptForLLM = `Identify key concepts and statements related to them in the following text. Provide the output as a JSON object where keys are colors (e.g., "red", "blue", "green", "yellow", "purple", "orange", "cyan") representing priority/category, and values are arrays of strings (statements). Ensure each statement is an exact phrase or sentence from the text and avoid significant overlaps between statements if possible. Example: {"red":["This is a critical point.", "Another important idea."], "blue":["A supporting detail.", "Further explanation."],"no":total-number-of-lines-in-all-colour-category}. Text: "${textToProcess}"`;
                    apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=${aiModel}&json=true`;
                    break;
                case 'auto_questions':
                    promptForLLM = `Generate ${numQuestions} multiple-choice questions from the following text. For each question, provide 4 options, the correct answer's 0-based index, a difficulty tag ('easy', 'medium', or 'hard'), and a concise explanation for the correct answer. Return the result strictly as a JSON array of objects. Example: [{"no":1,"question":"What is the capital of France?","options":["Berlin","Paris","Rome","Madrid"],"correct":1,"difficulty":"easy","explanation":"Paris is the capital of France."}]. Text: "${textToProcess}"`;
                    apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=${aiModel}&json=true`;
                    break;
                case 'short_notes':
                    promptForLLM = `Analyze the following text. Extract precise, self-contained lines or short phrases (max 2 sentences) that represent key information, important concepts, or facts that might be easily forgotten. Classify each extracted note with one of these importance tags: "most important", "important", or "can be forgotten". Return the result strictly as a JSON array of objects, where each object has "text" (the extracted line/phrase) and "importanceTag" (one of the specified tags). Ensure the "text" is an exact quote from the provided document. Wrap the entire JSON array in a markdown code block with 'json' language tag (e.g., \`\`\`json [...] \`\`\`). Example: \`\`\`json [{"text":"The quick brown fox jumps over the lazy dog.","importanceTag":"important"},{"text":"All planets orbit the sun.","importanceTag":"most important"}]\`\`\`. Text: "${textToProcess}"`;
                    apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=${aiModel}&json=true`;
                    break;
                default:
                    return;
            }
            newChatHistory = [{ role: 'user', text: textToProcess }];
        }

        setAiResponse(prev => ({
            ...prev,
            visible: (action === 'explain' || action === 'summarize' || action === 'ask_question'),
            isLoading: true,
            content: '',
            chatHistory: newChatHistory,
            currentAiAction: action
        }));

        if (action === 'concepts' || action === 'auto_questions' || action === 'short_notes') {
            setShowLoadingOverlay(true);
        }

        try {
            const fetchOptions: RequestInit = {
                method: fetchMethod,
                headers: headers,
            };

            const response = await fetch(apiUrl, fetchOptions);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            let aiText: string;
            const rawResponseText = await response.text();
            const parsedData = parseJsonResponse(rawResponseText);

            if (action === 'concepts') {
                if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
                    aiText = "Concepts identified and highlighted.";
                    highlightConcepts(parsedData);
                    setNotification({ message: "Key concepts identified and highlighted!", type: "success", id: Date.now() });
                } else {
                    aiText = "AI response was not valid for concepts. Please try again. Raw: " + rawResponseText;
                    setNotification({ message: "Failed to identify concepts. AI response invalid.", type: "error", id: Date.now() });
                }
            } else if (action === 'auto_questions') {
                if (parsedData && Array.isArray(parsedData)) {
                    const parsedQuestions: Question[] = parsedData;
                    setQuizQuestions(parsedQuestions);
                    setShowQuiz(true);
                    setUserAnswers({});
                    setQuizSubmitted(false);
                    setScore(null);
                    setCurrentQuizQuestionIndex(0);
                    aiText = "Quiz generated successfully!";
                    setNotification({ message: "Quiz generated successfully!", type: "success", id: Date.now() });
                } else {
                    aiText = "AI response was not valid for questions. Please try again. Raw: " + rawResponseText;
                    setQuizQuestions([]);
                    setShowQuiz(false);
                    setNotification({ message: "Failed to generate quiz. AI response invalid.", type: "error", id: Date.now() });
                }
            } else if (action === 'short_notes') {
                let finalParsedNotes: ShortNoteEntry[] | null = null;

                if (parsedData && Array.isArray(parsedData)) {
                    finalParsedNotes = parsedData;
                } else if (parsedData && typeof parsedData === 'object' && parsedData.json && Array.isArray(parsedData.json)) {
                    finalParsedNotes = parsedData.json;
                }

                if (finalParsedNotes && Array.isArray(finalParsedNotes)) {
                    const parsedNotes: ShortNoteEntry[] = finalParsedNotes;
                    for (const note of parsedNotes) {
                        await saveShortNote({
                            page: currentPage,
                            text: note.text,
                            importanceTag: note.importanceTag,
                            timestamp: new Date().toISOString()
                        });
                    }
                    setShowShortNotesUI(true);
                    aiText = "Short notes generated and saved successfully!";
                    setNotification({ message: "Short notes generated and saved successfully!", type: "success", id: Date.now() });
                } else {
                    aiText = "AI response was not valid for short notes. Please try again. Raw: " + rawResponseText;
                    setShortNotes([]);
                    setShowShortNotesUI(false);
                    setNotification({ message: "Failed to generate short notes. AI response invalid.", type: "error", id: Date.now() });
                }
            } else {
                aiText = rawResponseText;
            }

            setAiResponse(prev => ({
                ...prev,
                isLoading: false,
                content: aiText,
                chatHistory: [...newChatHistory, { role: 'ai', text: aiText }]
            }));
        } catch (error) {
            console.error("AI API Error:", error);
            setAiResponse(prev => ({
                ...prev,
                isLoading: false,
                content: "An error occurred while fetching the AI response.",
                chatHistory: [...newChatHistory, { role: 'ai', text: "An error occurred." }]
            }));
            setNotification({ message: "An error occurred while fetching AI response.", type: "error", id: Date.now() });
        } finally {
            setShowLoadingOverlay(false);
        }
    };

    const regenerateShortNotes = async (userCustomPrompt: string = '') => {
        if (!pdfDoc || !db || !userId || !pdfFile) {
            setNotification({ message: "Cannot regenerate notes: PDF, DB, or user not ready.", type: "error", id: Date.now() });
            return;
        }

        await deleteAllShortNotesForPage(currentPage);

        let textToProcess: string;
        try {
            const page = await pdfDoc.getPage(currentPage);
            const textContent = await page.getTextContent();
            textToProcess = textContent.items.map((item: any) => item.str).join(' ').replace(/\s+/g, ' ').trim();
        } catch (error) {
            console.error("Error fetching full page text for AI analysis during regeneration:", error);
            setNotification({ message: "Error fetching page text for AI analysis during regeneration.", type: "error", id: Date.now() });
            return;
        }

        if (!textToProcess) {
            setNotification({ message: "No text found on this page to generate notes from.", type: "info", id: Date.now() });
            return;
        }

        let promptForLLM = `Analyze the following text. Extract precise, self-contained lines or short phrases (max 2 sentences) that represent key information, important concepts, or facts that might be easily forgotten. Classify each extracted note with one of these importance tags: "most important", "important", or "can be forgotten". Return the result strictly as a JSON array of objects, where each object has "text" (the extracted line/phrase) and "importanceTag" (one of the specified tags). Ensure the "text" is an exact quote from the provided document. Wrap the entire JSON array in a markdown code block with 'json' language tag (e.g., \`\`\`json [...] \`\`\`).`;
        if (userCustomPrompt.trim()) {
            promptForLLM += ` Additionally, consider the following specific instructions: "${userCustomPrompt.trim()}"`;
        }
        promptForLLM += ` Text: "${textToProcess}"`;

        const apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=${aiModel}&json=true`;

        setAiResponse(prev => ({
            ...prev,
            visible: false,
            isLoading: true,
            content: '',
            chatHistory: [{ role: 'user', text: `Regenerating short notes for page ${currentPage}` + (userCustomPrompt ? ` with prompt: "${userCustomPrompt}"` : '') }],
            currentAiAction: 'short_notes'
        }));
        setShowShortNotesUI(false);
        setShowLoadingOverlay(true);

        try {
            const response = await fetch(apiUrl);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const rawResponseText = await response.text();
            const parsedData = parseJsonResponse(rawResponseText);

            let finalParsedNotes: ShortNoteEntry[] | null = null;

            if (parsedData && Array.isArray(parsedData)) {
                finalParsedNotes = parsedData;
            } else if (parsedData && typeof parsedData === 'object' && parsedData.json && Array.isArray(parsedData.json)) {
                finalParsedNotes = parsedData.json;
            }

            if (finalParsedNotes && Array.isArray(finalParsedNotes)) {
                const parsedNotes: ShortNoteEntry[] = finalParsedNotes;

                for (const note of parsedNotes) {
                    await saveShortNote({
                        page: currentPage,
                        text: note.text,
                        importanceTag: note.importanceTag,
                        timestamp: new Date().toISOString()
                    });
                }
                setShortNotesRegenPrompt('');
                setShowShortNotesUI(true);
                setAiResponse(prev => ({
                    ...prev,
                    isLoading: false,
                    content: "Short notes regenerated and saved successfully!",
                    chatHistory: [...prev.chatHistory, { role: 'ai', text: "Short notes regenerated and saved successfully!" }]
                }));
                setNotification({ message: "Short notes regenerated and saved successfully!", type: "success", id: Date.now() });
            } else {
                setAiResponse(prev => ({
                    ...prev,
                    isLoading: false,
                    content: "An error occurred while regenerating short notes. AI response was not in expected format.",
                    chatHistory: [...prev.chatHistory, { role: 'ai', text: "An error occurred during regeneration." }]
                }));
                setShowShortNotesUI(true);
                setNotification({ message: "Failed to regenerate short notes. AI response invalid.", type: "error", id: Date.now() });
            }
        } catch (error) {
            console.error("Error regenerating short notes:", error);
            setAiResponse(prev => ({
                ...prev,
                isLoading: false,
                content: "An error occurred while regenerating short notes.",
                chatHistory: [...prev.chatHistory, { role: 'ai', text: "An error occurred during regeneration." }]
            }));
            setShowShortNotesUI(true);
            setNotification({ message: "An error occurred while regenerating short notes.", type: "error", id: Date.now() });
        } finally {
            setShowLoadingOverlay(false);
        }
    };

    const getMistakeExplanation = async (question: string, wrongAnswer: string, correctAnswer: string, context?: string): Promise<string> => {
        let prompt = `The user answered "${wrongAnswer}" to the question "${question}", but the correct answer was "${correctAnswer}". Explain why "${wrongAnswer}" is incorrect and why "${correctAnswer}" is correct, in a concise manner.`;
        if (context) {
            prompt += `\n\nContext: "${context}"`;
        }
        const apiUrl = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${aiModel}`;

        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            console.error("Error fetching mistake explanation from AI:", error);
            setNotification({ message: "Error fetching mistake explanation from AI.", type: "error", id: Date.now() });
            return "Could not fetch explanation.";
        }
    };

    const handleCheckQuiz = async () => {
        let currentScore = 0;
        const newMistakes: Omit<MistakeEntry, 'id'>[] = [];

        for (const question of quizQuestions) {
            const userAnswerIndex = userAnswers[question.no];
            const isAttempted = userAnswerIndex !== undefined && userAnswerIndex !== null;

            if (isAttempted && userAnswerIndex === question.correct) {
                currentScore++;
            } else {
                const wrongAnswerText = isAttempted ? question.options[userAnswerIndex!] : "Unattempted";
                const correctAnswerText = question.options[question.correct];
                const explanation = question.explanation;

                newMistakes.push({
                    page: currentPage,
                    question: question.question,
                    wrongAnswer: wrongAnswerText,
                    correctAnswer: correctAnswerText,
                    explanation: explanation,
                    timestamp: new Date().toISOString(),
                    isUnattempted: !isAttempted,
                    context: question.question,
                    difficulty: question.difficulty
                });
            }
        }

        setScore(currentScore);
        setQuizSubmitted(true);

        await Promise.all(newMistakes.map(mistake => saveMistake(mistake)));
    };

    const saveAiResponseAsNote = (): void => {
        if (activeAnnotation && aiResponse.content && !aiResponse.isLoading) {
            const chatHistoryString = aiResponse.chatHistory.map(h => `${h.role.toUpperCase()}: ${h.text}`).join('\n\n');
            const updatedNote = `${activeAnnotation.note ? activeAnnotation.note + '\n\n' : ''}--- AI Chat History ---\n${chatHistoryString}`;
            updateAnnotationNote(activeAnnotation.id, updatedNote);
            setAiResponse(prev => ({ ...prev, visible: false, chatHistory: [], currentAiAction: null }));
            setNotification({ message: "AI insight saved to note!", type: "success", id: Date.now() });
        } else {
            setNotification({ message: "Cannot save AI insight: No active note or AI content.", type: "info", id: Date.now() });
        }
    };

    const handleGoogleSignIn = async () => {
        if (!auth) {
            setNotification({ message: "Firebase authentication not initialized.", type: "error", id: Date.now() });
            return;
        }
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
            setNotification({ message: "Signed in with Google successfully!", type: "success", id: Date.now() });
        } catch (error) {
            console.error("Google Sign-In failed:", error);
            setNotification({ message: `Google Sign-In failed: ${error.message}`, type: "error", id: Date.now() });
        }
    };

    const handleSignOut = async () => {
        if (!auth) {
            setNotification({ message: "Firebase authentication not initialized.", type: "error", id: Date.now() });
            return;
        }
        // Save current session time before signing out
        if (db && userId && currentSessionElapsed > 0 && !isSavingTimeRef.current) {
            isSavingTimeRef.current = true;
            try {
                const timeDocRef = doc(db, `artifacts/${appId}/users/${userId}/sessionTime`, 'total');
                const docSnap = await getDoc(timeDocRef);
                const existingTotal = docSnap.exists() ? docSnap.data().totalSeconds : 0;
                await setDoc(timeDocRef, { totalSeconds: existingTotal + currentSessionElapsed }, { merge: true });
                console.log(`Saved ${currentSessionElapsed} seconds on sign out. New total: ${existingTotal + currentSessionElapsed}`);
            } catch (error) {
                console.error("Error saving time on sign out:", error);
            } finally {
                isSavingTimeRef.current = false;
            }
        }

        try {
            await signOut(auth);
            setUserId(null);
            setIsAuthReady(false);
            setPdfFile(null);
            setAnnotations([]);
            setMistakeBook([]);
            setShortNotes([]);
            setTotalTimeSpent(0); // Reset total time on sign out
            setCurrentSessionElapsed(0); // Reset current session time
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
                timerIntervalRef.current = null;
            }
            setNotification({ message: "Signed out successfully!", type: "success", id: Date.now() });
        } catch (error) {
            console.error("Sign out failed:", error);
            setNotification({ message: `Sign out failed: ${error.message}`, type: "error", id: Date.now() });
        }
    };

    // --- Notification Management ---
    useEffect(() => {
        if (notification) {
            if (notificationTimeoutRef.current) {
                clearTimeout(notificationTimeoutRef.current);
            }
            notificationTimeoutRef.current = window.setTimeout(() => {
                setNotification(null);
            }, 5000);
        }
        return () => {
            if (notificationTimeoutRef.current) {
                clearTimeout(notificationTimeoutRef.current);
            }
        };
    }, [notification]);


    // --- UI Components ---
    const TopBar = (): JSX.Element => (
        <div className="fixed top-0 left-0 right-0 bg-white shadow-sm p-2 flex items-center justify-between z-30 border-b border-gray-100">
            <div className="flex items-center space-x-2">
                <label htmlFor="pdf-upload-top" className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-full cursor-pointer border border-gray-200 shadow-sm`}
                    style={{ backgroundColor: 'rgb(240,244,249)', color: 'rgb(55, 65, 81)' }}
                >
                    <Upload size={16} className="mr-1" />
                    Upload PDF
                </label>
                <input id="pdf-upload-top" type="file" accept="application/pdf" onChange={handleFileChange} className="hidden" />
                <h1 className="text-base font-semibold text-gray-800 ml-2">Codex Interactive</h1>
            </div>

            {pdfFile && (
                <div className="flex items-center space-x-1">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"><ChevronLeft size={16} className="text-gray-600" /></button>
                    <span className="text-sm font-medium text-gray-700">{currentPage} / {totalPages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="p-1 rounded-full hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"><ChevronRight size={16} className="text-gray-600" /></button>
                    <div className="w-px h-4 bg-gray-200 mx-1"></div>
                    <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="p-1 rounded-full hover:bg-gray-100"><Search size={14} className="text-gray-500" />-</button>
                    <span className="text-sm font-medium text-gray-700">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="p-1 rounded-full hover:bg-gray-100"><Search size={14} className="text-gray-500" />+</button>
                </div>
            )}

            <div className="flex items-center space-x-1">
                <div className="relative">
                    <select
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 focus:ring-blue-500 focus:border-blue-500 appearance-none pr-6"
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' class='lucide lucide-chevrons-up-down'%3E%3Cpolyline points='7 15 12 20 17 15'%3E%3C/polyline%3E%3Cpolyline points='17 9 12 4 7 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '1em' }}
                        title="Select AI Model"
                    >
                        <option value="mistral">Mistral</option>
                        <option value="llamascout">Llama Scout</option>
                    </select>
                    <ChevronsUpDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>
                <button
                    onClick={() => handleAiAction('summarize')}
                    disabled={!selectedText || aiResponse.isLoading}
                    className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    title="Summarize Selected Text"
                >
                    <Zap size={14} className="mr-1"/> Summarize
                </button>
                <button
                    onClick={() => handleAiAction('explain')}
                    disabled={!selectedText || aiResponse.isLoading}
                    className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    title="Explain Selected Text"
                >
                    <Bot size={14} className="mr-1"/> Explain
                </button>
                <button
                    onClick={() => handleAiAction('concepts')}
                    disabled={aiResponse.isLoading || !pdfFile}
                    className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                    title="Identify Key Concepts in Selected Text"
                >
                    <Type size={14} className="mr-1"/> Key Concepts
                </button>
                {pdfFile && (
                    <>
                        <div className="flex items-center space-x-1">
                            <select
                                value={numQuestions}
                                onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                                className="px-2 py-1 rounded-full text-xs font-medium text-gray-700 bg-gray-50 border border-gray-200 focus:ring-blue-500 focus:border-blue-500"
                                title="Number of Questions"
                            >
                                {Array.from({ length: 26 }, (_, i) => i + 5).map(num => (
                                    <option key={num} value={num}>{num}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => handleAiAction('auto_questions')}
                                disabled={aiResponse.isLoading}
                                className="px-2.5 py-1 rounded-full text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                                title="Generate Questions from Current Page"
                            >
                                <ClipboardList size={14} className="mr-1"/> Auto Questions
                            </button>
                        </div>
                        <button
                            onClick={() => handleAiAction('short_notes')}
                            disabled={aiResponse.isLoading}
                            className="px-2.5 py-1 rounded-full text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                            title="Generate Short Notes from Current Page"
                        >
                            <NotebookText size={14} className="mr-1"/> Short Notes
                        </button>
                    </>
                )}
                <button
                    onClick={() => setShowHelpModal(true)}
                    className="p-1.5 rounded-full hover:bg-gray-100"
                    title="Help with Highlight Colors"
                >
                    <HelpCircle size={16} className="text-gray-600" />
                </button>
            </div>
        </div>
    );

    const ToolPalette = (): JSX.Element => {
        const transformValue = isToolPaletteOpen ? 'translateX(0)' : 'translateX(-100%)';

        return (
            <>
                {!isToolPaletteOpen && (
                    <div
                        className="fixed top-16 left-0 h-[calc(100vh-64px)] w-4 z-30"
                        onMouseEnter={() => setIsToolPaletteOpen(true)}
                        onMouseLeave={() => setIsToolPaletteOpen(false)}
                    >
                        <div className="absolute top-1/2 -translate-y-1/2 right-0 h-8 w-4 bg-gray-200 rounded-r-md flex items-center justify-center cursor-pointer">
                            <ChevronRight size={12} strokeWidth={1} className="text-gray-500 opacity-70" />
                        </div>
                    </div>
                )}

                <div
                    ref={toolPaletteRef}
                    className="fixed top-16 left-0 bg-white shadow-md rounded-r-lg p-1.5 flex flex-col items-center space-y-1 z-30 border border-gray-100 transition-transform duration-300 ease-in-out"
                    style={{ transform: transformValue }}
                    onMouseEnter={() => setIsToolPaletteOpen(true)}
                    onMouseLeave={() => setIsToolPaletteOpen(false)}
                >
                    {[
                        { id: 'select', icon: MousePointer, label: 'Select Tool' },
                        { id: 'highlight', icon: Highlighter, label: 'Highlight Tool' },
                        { id: 'note', icon: Plus, label: 'Add Note (select text)' },
                        { id: 'erase', icon: Eraser, label: 'Erase Tool' }
                    ].map(tool => (
                        <button key={tool.id} onClick={() => setSelectedTool(tool.id as 'select' | 'highlight' | 'erase' | 'note')} className={`p-2 rounded-full ${selectedTool === tool.id ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100 text-gray-600'}`} title={tool.label}>
                            <tool.icon size={16} />
                        </button>
                    ))}
                    {selectedTool === 'highlight' && (
                        <ColorPicker
                            color={highlightColor}
                            onChange={setHighlightColor}
                        />
                    )}
                </div>
            </>
        );
    };

    const Sidebar = (): JSX.Element => {
        const sidebarWidth = isSidebarExpanded ? '256px' : '64px';
        const sidebarPadding = isSidebarExpanded ? 'p-3' : 'p-2';
        const iconSize = 20;

        return (
            <div
                className="fixed top-0 left-0 h-screen bg-gray-50 flex flex-col border-r border-gray-100 shadow-sm z-20 transition-all duration-300 ease-in-out"
                style={{ width: sidebarWidth }}
                onMouseEnter={() => setIsSidebarExpanded(true)}
                onMouseLeave={() => setIsSidebarExpanded(false)}
            >
                <div className={`flex items-center justify-center ${sidebarPadding} pt-3 pb-2 border-b border-gray-100`}>
                    {isSidebarExpanded ? (
                        <h2 className="text-base font-semibold text-gray-800 whitespace-nowrap">Codex Interactive</h2>
                    ) : (
                        <Menu size={iconSize} className="text-gray-600 cursor-pointer" onClick={() => setIsSidebarExpanded(!isSidebarExpanded)} title="Expand Menu" />
                    )}
                </div>

                <nav className="flex-grow flex flex-col space-y-1 mt-2 overflow-y-auto custom-scrollbar">
                    <button
                        onClick={() => {
                            setIsSidebarExpanded(true);
                        }}
                        className={`flex items-center w-full text-left rounded-md hover:bg-gray-100 text-gray-700 ${sidebarPadding} ${isSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                        title="View Annotations"
                    >
                        <BookMarked size={iconSize} className={isSidebarExpanded ? "mr-3" : ""} />
                        {isSidebarExpanded && <span className="text-sm font-medium">Annotations</span>}
                    </button>

                    <button
                        onClick={() => {
                            setShowMistakeBook(true);
                            setIsSidebarExpanded(true);
                        }}
                        disabled={!pdfFile}
                        className={`flex items-center w-full text-left rounded-md hover:bg-gray-100 text-gray-700 ${sidebarPadding} ${isSidebarExpanded ? 'justify-start' : 'justify-center'} disabled:opacity-50 disabled:cursor-not-allowed`}
                        title="View Mistake Book"
                    >
                        <BookOpen size={iconSize} className={isSidebarExpanded ? "mr-3" : ""} />
                        {isSidebarExpanded && <span className="text-sm font-medium">Mistake Book</span>}
                    </button>

                    <button
                        onClick={() => {
                            setShowShortNotesUI(true);
                            setIsSidebarExpanded(true);
                        }}
                        disabled={!pdfFile}
                        className={`flex items-center w-full text-left rounded-md hover:bg-gray-100 text-gray-700 ${sidebarPadding} ${isSidebarExpanded ? 'justify-start' : 'justify-center'} disabled:opacity-50 disabled:cursor-not-allowed`}
                        title="View Short Notes"
                    >
                        <NotebookText size={iconSize} className={isSidebarExpanded ? "mr-3" : ""} />
                        {isSidebarExpanded && <span className="text-sm font-medium">Short Notes</span>}
                    </button>

                    {isSidebarExpanded && pdfFile && (
                        <button
                            onClick={() => { setCurrentMistakeToEdit(null); setShowMistakeEditor(true); }}
                            className={`flex items-center w-full text-left rounded-md hover:bg-gray-100 text-gray-700 ${sidebarPadding} justify-start`}
                            title="Add Custom Mistake"
                        >
                            <Plus size={iconSize - 4} className="mr-3 ml-1" />
                            <span className="text-sm font-medium">Add Custom Mistake</span>
                        </button>
                    )}

                    {isSidebarExpanded && userId && (
                        <div className="px-3 py-2 text-xs text-gray-400 mt-auto border-t border-gray-100 pt-3">
                            <p className="truncate">User ID: {userId}</p>
                        </div>
                    )}
                </nav>

                <div className={`mt-auto ${sidebarPadding} border-t border-gray-100 py-3`}>
                    {auth && (
                        <>
                            {auth.currentUser ? (
                                <button
                                    onClick={handleSignOut}
                                    className={`flex items-center w-full text-left rounded-md hover:bg-gray-100 text-gray-700 ${sidebarPadding} ${isSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                    title="Sign Out"
                                >
                                    <LogOut size={iconSize} className={isSidebarExpanded ? "mr-3" : ""} />
                                    {isSidebarExpanded && <span className="text-sm font-medium whitespace-nowrap">Sign Out</span>}
                                </button>
                            ) : (
                                <button
                                    onClick={handleGoogleSignIn}
                                    className={`flex items-center w-full text-left rounded-md hover:bg-gray-100 text-gray-700 ${sidebarPadding} ${isSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                    title="Sign In with Google"
                                >
                                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google icon" className={isSidebarExpanded ? "w-4 h-4 mr-3" : "w-4 h-4"} />
                                    {isSidebarExpanded && <span className="text-sm font-medium whitespace-nowrap">Sign In</span>}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        );
    };

    const NoteEditor = (): JSX.Element | null => {
        if (!activeAnnotation) return null;
        const [note, setNote] = useState<string>(activeAnnotation.note || '');
        useEffect(() => setNote(activeAnnotation.note || ''), [activeAnnotation]);

        const handleSave = (): void => {
            updateAnnotationNote(activeAnnotation.id, note);
            setAiResponse(prev => ({ ...prev, visible: false, chatHistory: [], currentAiAction: null }));
            setActiveAnnotation(null);
        };

        return (
            <div className="fixed inset-0 bg-black/20 z-40 flex items-center justify-center" onClick={() => setActiveAnnotation(null)}>
                <div className="bg-white rounded-lg shadow-xl w-[400px] flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-semibold text-gray-800 text-base">Edit Note for {activeAnnotation.type === 'highlight' ? 'Highlight' : 'Text Note'} on Page {activeAnnotation.page}</h3>
                        <button onClick={() => setActiveAnnotation(null)} className="p-1 rounded-full hover:bg-gray-100"><X size={16}/></button>
                    </div>
                    <div className="p-3 flex-grow">
                        <textarea
                            value={note}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
                            className="w-full h-32 p-2 text-sm border border-gray-200 rounded-md focus:ring-blue-200 focus:border-blue-300 focus:outline-none"
                            placeholder="Add your thoughts, questions, or connections here..."
                        ></textarea>
                    </div>
                    <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end space-x-2">
                        <button onClick={() => setActiveAnnotation(null)} className="px-3 py-1.5 rounded-full text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100">Cancel</button>
                        <button onClick={handleSave} className="px-3 py-1.5 rounded-full text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"><Save size={14} className="inline mr-1"/> Save Note</button>
                    </div>
                </div>
            </div>
        );
    };

    const ContextMenuComponent = (): JSX.Element | null => {
        if (!contextMenu) return null;
        return (
            <div
                style={{ top: contextMenu.y, left: contextMenu.x }}
                className="fixed bg-white shadow-lg rounded-md p-1.5 z-50 animate-fade-in-fast border border-gray-100"
                onMouseLeave={() => setContextMenu(null)}
            >
                <div className="flex items-center p-2 border-b border-gray-100 mb-1">
                    <Bot size={16} className="text-blue-500 mr-1.5"/>
                    <h4 className="font-semibold text-sm text-gray-700">AI Assistant</h4>
                </div>
                <ul className="text-sm text-gray-600">
                    <li onClick={() => handleAiAction('explain')} className="px-2.5 py-1.5 hover:bg-gray-50 rounded-sm cursor-pointer">Explain This</li>
                    <li onClick={() => handleAiAction('summarize')} className="px-2.5 py-1.5 hover:bg-gray-50 rounded-sm cursor-pointer">Summarize</li>
                    <li onClick={() => handleAiAction('concepts')} className="px-2.5 py-1.5 hover:bg-gray-50 rounded-sm cursor-pointer">Identify Key Concepts</li>
                    <li onClick={() => handleAiAction('ask_question')} className="px-2.5 py-1.5 hover:bg-gray-50 rounded-sm cursor-pointer flex items-center">
                        <HelpCircle size={14} className="mr-1.5"/> Ask a Question
                    </li>
                </ul>
            </div>
        );
    };

    const AiResponseWindow = (): JSX.Element | null => {
        if (!aiResponse.visible) return null;

        const aiWindowRef = useRef<HTMLDivElement>(null);
        const chatContentRef = useRef<HTMLDivElement>(null);
        const [isDragging, setIsDragging] = useState<boolean>(false);
        const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
        const [chatInput, setChatInput] = useState<string>('');

        useEffect(() => {
            if (chatContentRef.current) {
                chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight;
            }
        }, [aiResponse.chatHistory]);

        const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            if (aiWindowRef.current) {
                const rect = aiWindowRef.current.getBoundingClientRect();
                setIsDragging(true);
                setDragOffset({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                });
            }
        };

        const handleMouseMove = useCallback((e: MouseEvent) => {
            if (isDragging) {
                setAiResponse(prev => ({
                    ...prev,
                    position: {
                        x: e.clientX - dragOffset.x,
                        y: e.clientY - dragOffset.y,
                    },
                }));
            }
        }, [isDragging, dragOffset]);

        const handleMouseUp = useCallback(() => {
            setIsDragging(false);
        }, []);

        useEffect(() => {
            if (isDragging) {
                window.addEventListener('mousemove', handleMouseMove);
                window.addEventListener('mouseup', handleMouseUp);
            } else {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }, [isDragging, handleMouseMove, handleMouseUp]);

        const handleChatSubmit = () => {
            if (chatInput.trim() && !aiResponse.isLoading) {
                if (aiResponse.currentAiAction) {
                    handleAiAction(aiResponse.currentAiAction, chatInput);
                }
                setChatInput('');
            }
        };

        return (
            <div
                ref={aiWindowRef}
                style={{ top: aiResponse.position.y, left: aiResponse.position.x, width: aiResponse.size.width, height: aiResponse.size.height }}
                className="fixed bg-white shadow-lg rounded-lg border border-gray-100 flex flex-col z-40 overflow-hidden resize-both"
            >
                <div
                    className="h-7 bg-gray-50 border-b border-gray-100 flex items-center justify-between px-2 cursor-move select-none"
                    onMouseDown={handleMouseDown}
                >
                    <div className="flex items-center space-x-1">
                        <Bot size={12} className="text-blue-500" />
                        <span className="text-xs font-semibold text-gray-700">AI Assistant</span>
                    </div>
                    <div className="flex items-center space-x-0.5">
                        <button onClick={() => setAiResponse(prev => ({ ...prev, visible: false, chatHistory: [], currentAiAction: null }))} className="p-0.5 rounded-full hover:bg-gray-100"><X size={12}/></button>
                    </div>
                </div>
                <div ref={chatContentRef} className="p-3 flex-grow overflow-y-auto text-xs space-y-1.5">
                    {aiResponse.chatHistory.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`p-2 rounded-lg max-w-[80%] ${msg.role === 'user' ? 'bg-blue-50 text-blue-800' : 'bg-gray-50 text-gray-800'}`}>
                                <p className="font-semibold capitalize text-[0.65rem]">{msg.role}:</p>
                                <p>{msg.text}</p>
                            </div>
                        </div>
                    ))}
                    {aiResponse.isLoading && (
                        <div className="flex items-center justify-center py-2">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                        </div>
                    )}
                </div>
                <div className="p-2 bg-gray-50 border-t border-gray-100 flex flex-col space-y-1.5">
                    <div className="flex space-x-1.5">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyPress={(e) => { if (e.key === 'Enter') handleChatSubmit(); }}
                            className="flex-grow p-1.5 border border-gray-200 rounded-md text-xs focus:ring-blue-200 focus:border-blue-300"
                            placeholder="Ask a follow-up question..."
                            disabled={aiResponse.isLoading}
                        />
                        <button onClick={handleChatSubmit} disabled={aiResponse.isLoading || !chatInput.trim()} className="px-2.5 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                            Send
                        </button>
                    </div>
                    <button onClick={saveAiResponseAsNote} disabled={!activeAnnotation || aiResponse.isLoading || !aiResponse.content} className="w-full px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed">
                        <Save size={12} className="inline mr-1"/> Save AI Insight to Active Note
                    </button>
                </div>
            </div>
        );
    };

    const QuizComponent = ({ questions, userAnswers, setUserAnswers, quizSubmitted, score, onCheckQuiz, onClose, onQuizComplete, currentQuestionIndex, setCurrentQuestionIndex }: {
        questions: Question[];
        userAnswers: { [questionNo: number]: number | null };
        setUserAnswers: React.Dispatch<React.SetStateAction<{ [questionNo: number]: number | null }>>;
        quizSubmitted: boolean;
        score: number | null;
        onCheckQuiz: () => void;
        onClose: () => void;
        onQuizComplete: (score: number | null, totalQuestions: number, attempted: number, unattempted: number, marked: number) => void;
        currentQuestionIndex: number;
        setCurrentQuestionIndex: React.Dispatch<React.SetStateAction<number>>;
    }): JSX.Element | null => {
        if (!questions.length) return null;

        const [markedForReview, setMarkedForReview] = useState<Set<number>>(() => {
            const initialMarked = new Set<number>();
            return initialMarked;
        });

        const currentQuestion = questions[currentQuestionIndex];

        useEffect(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === 'ArrowRight') {
                    handleNextQuestion();
                } else if (e.key === 'ArrowLeft') {
                    handlePrevQuestion();
                }
            };
            window.addEventListener('keydown', handleKeyDown);
            return () => {
                window.removeEventListener('keydown', handleKeyDown);
            };
        }, [currentQuestionIndex, questions.length]);

        const handleOptionChange = (questionNo: number, optionIndex: number) => {
            if (!quizSubmitted) {
                setUserAnswers(prev => ({
                    ...prev,
                    [questionNo]: optionIndex
                }));
            }
        };

        const handleNextQuestion = () => {
            setCurrentQuestionIndex(prev => Math.min(questions.length - 1, prev + 1));
        };

        const handlePrevQuestion = () => {
            setCurrentQuestionIndex(prev => Math.max(0, prev - 1));
        };

        const handleMarkForReview = (questionNo: number) => {
            setMarkedForReview(prev => {
                const newSet = new Set(prev);
                if (newSet.has(questionNo)) {
                    newSet.delete(questionNo);
                } else {
                    newSet.add(newSet.size + 1);
                }
                return newSet;
            });
        };

        const handleSubmitAndShowResults = async () => {
            const currentAttemptedCount = Object.keys(userAnswers).filter(qNo => userAnswers[parseInt(qNo)] !== undefined && userAnswers[parseInt(qNo)] !== null).length;
            const currentUnattemptedCount = questions.length - currentAttemptedCount;
            const currentMarkedCount = markedForReview.size;

            onClose();
            onQuizComplete(score, questions.length, currentAttemptedCount, currentUnattemptedCount, currentMarkedCount);

            await onCheckQuiz();
        };

        const attemptedCount = Object.keys(userAnswers).filter(qNo => userAnswers[parseInt(qNo)] !== undefined && userAnswers[parseInt(qNo)] !== null).length;
        const unattemptedCount = questions.length - attemptedCount;
        const markedCount = markedForReview.size;


        return (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden">
                    <div className="p-2 border-b border-gray-200 flex justify-between items-center bg-gray-100 text-gray-800">
                        <h3 className="font-semibold text-base">Quiz Time!</h3>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 text-gray-600"><X size={16}/></button>
                    </div>

                    <div className="bg-gray-50 p-2 border-b border-gray-100 flex flex-wrap justify-around items-center text-xs font-medium text-gray-700">
                        <div className="flex items-center space-x-1 p-1 rounded-md bg-white shadow-sm border border-gray-100">
                            <CheckCircle size={14} className="text-green-500" />
                            <span>Attempted: {attemptedCount}</span>
                        </div>
                        <div className="flex items-center space-x-1 p-1 rounded-md bg-white shadow-sm border border-gray-100">
                            <XCircle size={14} className="text-red-500" />
                            <span>Unattempted: {unattemptedCount}</span>
                        </div>
                        <div className="flex items-center space-x-1 p-1 rounded-md bg-white shadow-sm border border-gray-100">
                            <Flag size={14} className="text-orange-500" />
                            <span>Marked: {markedCount}</span>
                        </div>
                        <div className="flex flex-wrap gap-0.5 mt-1 md:mt-0">
                            {questions.map((q, idx) => (
                                <button
                                    key={q.no}
                                    onClick={() => setCurrentQuestionIndex(idx)}
                                    className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center
                                        ${currentQuestionIndex === idx ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}
                                        ${userAnswers[q.no] !== undefined && userAnswers[parseInt(q.no)] !== null ? 'border-2 border-green-500' : ''}
                                        ${markedForReview.has(q.no) ? 'border-2 border-orange-500' : ''}
                                    `}
                                    title={`Question ${q.no} ${userAnswers[parseInt(q.no)] !== undefined && userAnswers[parseInt(q.no)] !== null ? '(Attempted)' : ''} ${markedForReview.has(q.no) ? '(Marked)' : ''}`}
                                >
                                    {q.no}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-grow p-4 overflow-y-auto custom-scrollbar">
                        <div className="bg-white p-4 rounded-lg shadow-sm mb-4 border border-gray-200">
                            <p className="font-semibold text-base text-gray-800 mb-3">{currentQuestion.no}. {currentQuestion.question}</p>
                            <p className="text-xs text-gray-600 mb-2">
                                Difficulty: <span className={`font-bold capitalize ${
                                    currentQuestion.difficulty === 'easy' ? 'text-green-600' :
                                    currentQuestion.difficulty === 'medium' ? 'text-yellow-600' :
                                    'text-red-600'
                                }`}>{currentQuestion.difficulty}</span>
                            </p>
                            <div className="space-y-2">
                                {currentQuestion.options.map((option, idx) => {
                                    const isSelected = userAnswers[currentQuestion.no] === idx;
                                    const isCorrect = quizSubmitted && idx === currentQuestion.correct;
                                    const isWrong = quizSubmitted && isSelected && idx !== currentQuestion.correct;
                                    const isUnattempted = quizSubmitted && userAnswers[currentQuestion.no] === undefined && !isSelected;

                                    let optionClasses = 'bg-white border-gray-200 hover:bg-gray-50';
                                    if (quizSubmitted) {
                                        if (isCorrect) {
                                            optionClasses = 'bg-green-50 border-green-200';
                                        } else if (isWrong) {
                                            optionClasses = 'bg-red-50 border-red-200';
                                        } else if (isUnattempted) {
                                            optionClasses = 'bg-yellow-50 border-yellow-200';
                                        }
                                    } else if (isSelected) {
                                        optionClasses = 'bg-blue-50 border-blue-200';
                                    }

                                    return (
                                        <label
                                            key={idx}
                                            className={`flex items-center p-3 rounded-md cursor-pointer transition-all duration-200 border ${optionClasses}`}
                                        >
                                            <input
                                                type="radio"
                                                name={`question-${currentQuestion.no}`}
                                                value={idx}
                                                checked={isSelected}
                                                onChange={() => handleOptionChange(currentQuestion.no, idx)}
                                                disabled={quizSubmitted}
                                                className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className={`text-gray-800 flex-grow text-sm ${isCorrect ? 'font-semibold' : ''}`}>
                                                {option}
                                            </span>
                                            {quizSubmitted && isCorrect && (
                                                <span className="ml-2 text-green-600 font-medium text-xs">Correct!</span>
                                            )}
                                            {quizSubmitted && isWrong && (
                                                <span className="ml-2 text-red-600 font-medium text-xs">Your Answer</span>
                                            )}
                                            {quizSubmitted && isUnattempted && (
                                                <span className="ml-2 text-yellow-600 font-medium text-xs">Unattempted</span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                            {quizSubmitted && (
                                <div className="mt-4 p-3 bg-blue-50 rounded-md border border-blue-100">
                                    <p className="font-semibold text-blue-800 mb-1.5 text-sm">Explanation:</p>
                                    <p className="text-xs text-blue-700">{currentQuestion.explanation}</p>
                                    <p className="text-[0.65rem] text-blue-600 mt-1.5">Difficulty: <span className="font-bold capitalize">{currentQuestion.difficulty}</span></p>
                                </div>
                            )}
                            <div className="mt-4 flex justify-end">
                                <button
                                    onClick={() => handleMarkForReview(currentQuestion.no)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center
                                        ${markedForReview.has(currentQuestion.no) ? 'bg-orange-50 text-orange-700 border border-orange-100 hover:bg-orange-100' : 'bg-[rgb(240,244,249)] text-gray-700 border border-gray-200 hover:bg-gray-200'}
                                        disabled:opacity-50 disabled:cursor-not-allowed shadow-sm`}
                                    disabled={quizSubmitted}
                                    style={!markedForReview.has(currentQuestion.no) ? { backgroundColor: 'rgb(240,244,249)' } : {}}
                                >
                                    <Flag size={14} className="mr-1" />
                                    {markedForReview.has(currentQuestion.no) ? 'Unmark for Review' : 'Mark for Review'}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="p-3 bg-gray-100 border-t border-gray-100 flex justify-between items-center">
                        <button
                            onClick={handlePrevQuestion}
                            disabled={currentQuestionIndex === 0}
                            className="px-4 py-1.5 rounded-full text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all duration-200"
                            style={{ backgroundColor: 'rgb(240,244,249)' }}
                        >
                            <ChevronLeft size={16} className="inline mr-1"/> Previous
                        </button>
                        {!quizSubmitted ? (
                            <button
                                onClick={handleSubmitAndShowResults}
                                className="px-5 py-1.5 rounded-full text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed shadow-sm transition-all duration-200"
                            >
                                Submit Quiz
                            </button>
                        ) : (
                            <button
                                onClick={() => onQuizComplete(score, questions.length, attemptedCount, unattemptedCount, markedCount)}
                                className="px-5 py-1.5 rounded-full text-sm font-semibold text-white bg-green-600 hover:bg-green-700 shadow-sm transition-all duration-200"
                            >
                                View Results
                            </button>
                        )}
                        <button
                            onClick={handleNextQuestion}
                            disabled={currentQuestionIndex === questions.length - 1}
                            className="px-4 py-1.5 rounded-full text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all duration-200"
                            style={{ backgroundColor: 'rgb(240,244,249)' }}
                        >
                            Next <ChevronRight size={16} className="inline ml-1"/>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const ResultComponent = ({ score, totalQuestions, attempted, unattempted, marked, onClose, onRetryQuiz, onViewMistakeBook }: {
        score: number | null;
        totalQuestions: number;
        attempted: number;
        unattempted: number;
        marked: number;
        onClose: () => void;
        onRetryQuiz: () => void;
        onViewMistakeBook: () => void;
    }): JSX.Element | null => {
        return (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col">
                    <div className="p-2 border-b border-gray-200 flex justify-between items-center bg-gray-100 text-gray-800">
                        <h3 className="font-semibold text-lg">Quiz Results</h3>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 text-gray-600"><X size={16}/></button>
                    </div>
                    <div className="p-4 space-y-3 text-center">
                        <div className="text-3xl font-bold text-blue-600">
                            Score: {score !== null ? `${score} / ${totalQuestions}` : 'Calculating...'}
                            {score === null && (
                                <div className="inline-block ml-3 animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-gray-700 font-medium text-sm">
                            <div className="p-2 bg-green-50 rounded-md shadow-sm border border-green-100">
                                <p className="text-base">Attempted:</p>
                                <p className="text-xl font-bold text-green-700">{attempted}</p>
                            </div>
                            <div className="p-2 bg-yellow-50 rounded-md shadow-sm border border-yellow-100">
                                <p className="text-base">Unattempted:</p>
                                <p className="text-xl font-bold text-yellow-700">{unattempted}</p>
                            </div>
                            <div className="p-2 bg-orange-50 rounded-md shadow-sm border border-orange-100">
                                <p className="text-base">Marked for Review:</p>
                                <p className="text-xl font-bold text-orange-700">{marked}</p>
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 mt-3">Great job on the quiz! Review your mistakes to learn more.</p>
                    </div>
                    <div className="p-3 bg-gray-100 border-t border-gray-100 flex justify-center space-x-3">
                        <button onClick={onViewMistakeBook} className="px-4 py-1.5 rounded-full text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-200 shadow-sm" style={{ backgroundColor: 'rgb(240,244,249)' }}>
                            <BookOpen size={16} className="inline mr-1"/> View Mistake Book
                        </button>
                        <button onClick={onRetryQuiz} className="px-4 py-1.5 rounded-full text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-200 shadow-sm" style={{ backgroundColor: 'rgb(240,244,249)' }}>
                            Retry Quiz
                        </button>
                        <button onClick={onClose} className="px-4 py-1.5 rounded-full text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-200 shadow-sm" style={{ backgroundColor: 'rgb(240,244,249)' }}>
                            Close
                        </button>
                    </div>
                </div>
            </div>
        );
    };


    const MistakeBookComponent = ({ mistakes, onClose, onDeleteMistake, onEditMistake, onAddCustomMistake }: {
        mistakes: MistakeEntry[];
        onClose: () => void;
        onDeleteMistake: (id: string) => void;
        onEditMistake: (mistake: MistakeEntry) => void;
        onAddCustomMistake: () => void;
    }): JSX.Element | null => {
        if (!showMistakeBook) return null;

        const mistakesForCurrentPage = mistakes.filter(m => m.page === currentPage);

        return (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden">
                    <div className="p-2 border-b border-gray-200 flex justify-between items-center bg-gray-100 text-gray-800">
                        <h3 className="font-semibold text-base">Mistake Book - Page {currentPage}</h3>
                        <div className="flex space-x-1.5">
                            <button
                                onClick={onAddCustomMistake}
                                className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-200 flex items-center shadow-sm"
                                style={{ backgroundColor: 'rgb(240,244,249)' }}
                            >
                                <Plus size={14} className="mr-1"/> Add Mistake
                            </button>
                            <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 text-gray-600"><X size={16}/></button>
                        </div>
                    </div>
                    <div className="flex-grow p-4 overflow-y-auto custom-scrollbar">
                        {mistakesForCurrentPage.length > 0 ? (
                            <div className="space-y-4">
                                {mistakesForCurrentPage.map((mistake, index) => (
                                    <div key={mistake.id || index}
                                        className={`p-3 rounded-lg shadow-sm border ${mistake.isUnattempted ? 'bg-yellow-50 border-yellow-100' : 'bg-red-50 border-red-100'}`}>
                                        <div className="flex justify-between items-start mb-1.5">
                                            <p className="font-semibold text-base text-gray-800">Question: {mistake.question}</p>
                                            <div className="flex space-x-1.5">
                                                <button onClick={() => onEditMistake(mistake)} className="text-gray-600 hover:text-blue-600 p-0.5 rounded-full"><Edit size={14}/></button>
                                                <button onClick={() => onDeleteMistake(mistake.id!)} className="text-gray-600 hover:text-red-600 p-0.5 rounded-full"><Trash2 size={14}/></button>
                                            </div>
                                        </div>
                                        <p className={`mb-1 ${mistake.isUnattempted ? 'text-yellow-700' : 'text-red-700'} text-sm`}>
                                            Your Answer: <span className="font-medium italic">"{mistake.wrongAnswer}"</span>
                                        </p>
                                        <p className="text-green-700 mb-2 text-sm">Correct Answer: <span className="font-medium">"{mistake.correctAnswer}"</span></p>
                                        {mistake.context && (
                                            <div className="mb-2 p-2 bg-gray-100 rounded-md text-xs text-gray-700 border border-gray-100">
                                                <p className="font-semibold mb-1">Context from PDF:</p>
                                                <p className="italic">{mistake.context}</p>
                                            </div>
                                        )}
                                        <div className="border-t border-gray-100 pt-2 mt-2">
                                            <p className="font-semibold text-gray-800 text-sm">Explanation:</p>
                                            <p className="text-gray-700 text-xs">{mistake.explanation}</p>
                                        </div>
                                        {mistake.difficulty && (
                                            <p className="text-[0.65rem] text-gray-600 mt-1.5 text-right">Difficulty: <span className="font-bold capitalize">{mistake.difficulty}</span></p>
                                        )}
                                        <p className="text-[0.65rem] text-gray-500 mt-2 text-right">Recorded: {new Date(mistake.timestamp).toLocaleString()}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-center text-gray-500 text-sm mt-8">No mistakes recorded for this page yet. Keep up the good work!</p>
                        )}
                    </div>
                    <div className="p-3 bg-gray-100 border-t border-gray-100 flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-5 py-1.5 rounded-full text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-200 shadow-sm transition-all duration-200"
                            style={{ backgroundColor: 'rgb(240,244,249)' }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const MistakeEditor = ({ mistakeToEdit, onSave, onClose }: {
        mistakeToEdit: MistakeEntry | null;
        onSave: (mistake: Omit<MistakeEntry, 'id'> | MistakeEntry) => void;
        onClose: () => void;
    }): JSX.Element | null => {
        const [question, setQuestion] = useState(mistakeToEdit?.question || '');
        const [wrongAnswer, setWrongAnswer] = useState(mistakeToEdit?.wrongAnswer || '');
        const [correctAnswer, setCorrectAnswer] = useState(mistakeToEdit?.correctAnswer || '');
        const [explanation, setExplanation] = useState(mistakeToEdit?.explanation || '');
        const [context, setContext] = useState(mistakeToEdit?.context || '');
        const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>(mistakeToEdit?.difficulty || 'medium');

        const handleSubmit = () => {
            if (!question || !wrongAnswer || !correctAnswer || !explanation) {
                setNotification({ message: "Please fill all required fields for the mistake.", type: "error", id: Date.now() });
                return;
            }
            const newMistake: Omit<MistakeEntry, 'id'> | MistakeEntry = {
                page: currentPage,
                question,
                wrongAnswer,
                correctAnswer,
                explanation,
                timestamp: new Date().toISOString(),
                difficulty,
                ...(context && { context })
            };

            if (mistakeToEdit && mistakeToEdit.id) {
                onSave({ ...newMistake, id: mistakeToEdit.id });
                setNotification({ message: "Mistake updated successfully!", type: "success", id: Date.now() });
            } else {
                onSave(newMistake);
                setNotification({ message: "Mistake added successfully!", type: "success", id: Date.now() });
            }
            onClose();
        };

        return (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-xl flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-semibold text-base">{mistakeToEdit ? 'Edit Mistake' : 'Add Custom Mistake'}</h3>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100"><X size={16}/></button>
                    </div>
                    <div className="p-3 space-y-3 overflow-y-auto custom-scrollbar max-h-[70vh]">
                        <div>
                            <label htmlFor="mistake-question" className="block text-xs font-medium text-gray-700 mb-0.5">Question</label>
                            <textarea id="mistake-question" value={question} onChange={e => setQuestion(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-md focus:ring-blue-200 focus:border-blue-300" rows={2} placeholder="Enter the question..."></textarea>
                        </div>
                        <div>
                            <label htmlFor="mistake-wrong-answer" className="block text-xs font-medium text-gray-700 mb-0.5">Your Wrong Answer</label>
                            <input type="text" id="mistake-wrong-answer" value={wrongAnswer} onChange={e => setWrongAnswer(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-md focus:ring-blue-200 focus:border-blue-300" placeholder="Enter your incorrect answer..."/>
                        </div>
                        <div>
                            <label htmlFor="mistake-correct-answer" className="block text-xs font-medium text-gray-700 mb-0.5">Correct Answer</label>
                            <input type="text" id="mistake-correct-answer" value={correctAnswer} onChange={e => setCorrectAnswer(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-md focus:ring-blue-200 focus:border-blue-300" placeholder="Enter the correct answer..."/>
                        </div>
                        <div>
                            <label htmlFor="mistake-explanation" className="block text-xs font-medium text-gray-700 mb-0.5">Explanation</label>
                            <textarea id="mistake-explanation" value={explanation} onChange={e => setExplanation(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-md focus:ring-blue-200 focus:border-blue-300" rows={4} placeholder="Explain why your answer was wrong and why the correct one is right..."></textarea>
                        </div>
                        <div>
                            <label htmlFor="mistake-context" className="block text-xs font-medium text-gray-700 mb-0.5">Context from PDF (Optional)</label>
                            <textarea id="mistake-context" value={context} onChange={e => setContext(e.target.value)} className="w-full p-2 text-sm border border-gray-200 rounded-md focus:ring-blue-200 focus:border-blue-300" rows={3} placeholder="Add relevant text from the PDF page..."></textarea>
                        </div>
                        <div>
                            <label htmlFor="mistake-difficulty" className="block text-xs font-medium text-gray-700 mb-0.5">Difficulty</label>
                            <select id="mistake-difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')} className="w-full p-2 text-sm border border-gray-200 rounded-md focus:ring-blue-200 focus:border-blue-300">
                                <option value="easy">Easy</option>
                                <option value="medium">Medium</option>
                                <option value="hard">Hard</option>
                            </select>
                        </div>
                    </div>
                    <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end space-x-2">
                        <button onClick={onClose} className="px-3 py-1.5 rounded-full text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100">Cancel</button>
                        <button onClick={handleSubmit} className="px-3 py-1.5 rounded-full text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"><Save size={14} className="inline mr-1"/> Save Mistake</button>
                    </div>
                </div>
            </div>
        );
    };

    const ShortNotesViewer = ({ notes, onClose, onDeleteNote, onRegenerateNotes, regenerationPrompt, setRegenerationPrompt }: {
        notes: ShortNoteEntry[];
        onClose: () => void;
        onDeleteNote: (id: string) => void;
        onRegenerateNotes: (prompt: string) => void;
        regenerationPrompt: string;
        setRegenerationPrompt: React.Dispatch<React.SetStateAction<string>>;
    }): JSX.Element | null => {
        if (!showShortNotesUI) return null;

        const notesForCurrentPage = notes.filter(note => note.page === currentPage);

        const groupedNotes = notesForCurrentPage.reduce((acc, note) => {
            if (!acc[note.importanceTag]) {
                acc[note.importanceTag] = [];
            }
            acc[note.importanceTag].push(note);
            return acc;
        }, {} as Record<ShortNoteEntry['importanceTag'], ShortNoteEntry[]>);

        const importanceOrder: ShortNoteEntry['importanceTag'][] = ['most important', 'important', 'can be forgotten'];

        const tagColors = {
            'most important': 'bg-red-50 text-red-700 border-red-100',
            'important': 'bg-blue-50 text-blue-700 border-blue-100',
            'can be forgotten': 'bg-yellow-50 text-yellow-700 border-yellow-100',
        };

        return (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl h-[85vh] flex flex-col overflow-hidden">
                    <div className="p-2 border-b border-gray-200 flex justify-between items-center bg-gray-100 text-gray-800">
                        <h3 className="font-semibold text-base">Short Notes - Page {currentPage}</h3>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 text-gray-600"><X size={16}/></button>
                    </div>
                    <div className="flex-grow p-4 overflow-y-auto custom-scrollbar">
                        {notesForCurrentPage.length > 0 ? (
                            <div className="space-y-4">
                                {importanceOrder.map(tag => {
                                    const notesInTag = groupedNotes[tag];
                                    if (!notesInTag || notesInTag.length === 0) return null;

                                    return (
                                        <div key={tag} className="mb-3">
                                            <h4 className={`text-base font-semibold mb-2 p-2 rounded-md ${tagColors[tag]} border`}>
                                                {tag.charAt(0).toUpperCase() + tag.slice(1)}
                                            </h4>
                                            <ul className="space-y-2">
                                                {notesInTag.map(note => (
                                                    <li key={note.id} className="p-3 rounded-lg bg-white border border-gray-200 flex justify-between items-start shadow-sm">
                                                        <p className="text-gray-800 text-sm flex-1 pr-2">{note.text}</p>
                                                        <button onClick={() => onDeleteNote(note.id!)} className="text-gray-400 hover:text-red-500 p-0.5"><Trash2 size={12}/></button>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-center text-gray-500 text-sm mt-8">No short notes generated for this page yet. Use the regenerate option below.</p>
                        )}
                    </div>
                    <div className="p-3 bg-gray-100 border-t border-gray-100 flex flex-col space-y-1.5">
                        <h4 className="font-semibold text-gray-700 text-sm">Regenerate Notes:</h4>
                        <textarea
                            value={regenerationPrompt}
                            onChange={(e) => setRegenerationPrompt(e.target.value)}
                            className="w-full p-2 text-xs border border-gray-200 rounded-md focus:ring-blue-200 focus:border-blue-300"
                            rows={1}
                            placeholder="Add specific instructions for regenerating notes..."
                        ></textarea>
                        <button
                            onClick={() => onRegenerateNotes(regenerationPrompt)}
                            className="px-3 py-1.5 rounded-full text-xs font-medium text-gray-700 border border-gray-200 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-sm"
                            disabled={aiResponse.isLoading}
                            style={{ backgroundColor: 'rgb(240,244,249)' }}
                        >
                            <Bot size={12} className="inline mr-1"/> Regenerate Short Notes
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const HighlightHelpModal = ({ onClose }: { onClose: () => void }): JSX.Element | null => {
        if (!showHelpModal) return null;

        const highlightLegend = [
            { color: 'rgba(255, 0, 0, 0.2)', name: 'Red', meaning: 'Most Important / Critical Point' },
            { color: 'rgba(0, 0, 255, 0.2)', name: 'Blue', meaning: 'Important Detail / Key Concept' },
            { color: 'rgba(0, 128, 0, 0.2)', name: 'Green', meaning: 'Supporting Information / Example' },
            { color: 'rgba(255, 255, 0, 0.2)', name: 'Yellow', meaning: 'General Highlight / Note-worthy' },
            { color: 'rgba(128, 0, 128, 0.2)', name: 'Purple', meaning: 'Definition / Terminology' },
            { color: 'rgba(255, 165, 0, 0.2)', name: 'Orange', meaning: 'Action Item / To Remember' },
            { color: 'rgba(0, 255, 255, 0.2)', name: 'Cyan', meaning: 'Cross-reference / Related Topic' },
        ];

        return (
            <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4" onClick={onClose}>
                <div className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <h3 className="font-semibold text-base">Highlight Color Legend</h3>
                        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100"><X size={16}/></button>
                    </div>
                    <div className="p-3 space-y-2">
                        {highlightLegend.map((item, index) => (
                            <div key={index} className="flex items-center space-x-2">
                                <div style={{ backgroundColor: item.color }} className="w-6 h-6 rounded-md border border-gray-200 flex-shrink-0"></div>
                                <p className="text-gray-800 text-sm"><span className="font-semibold">{item.name}:</span> {item.meaning}</p>
                            </div>
                        ))}
                    </div>
                    <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end">
                        <button onClick={onClose} className="px-3 py-1.5 rounded-full text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100">Close</button>
                    </div>
                </div>
            </div>
        );
    };

    const LoadingOverlay = (): JSX.Element | null => {
        if (!showLoadingOverlay) return null;
        return (
            <div
                className="fixed inset-0 flex items-center justify-center z-[100]"
                style={{ backgroundColor: 'rgb(240,244,249)' }}
            >
                <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
                    <p className="mt-4 text-gray-700 text-lg font-medium">Processing with AI...</p>
                </div>
            </div>
        );
    };

    const NotificationWidget = (): JSX.Element | null => {
        if (!notification) return null;

        const bgColor = notification.type === 'success' ? 'bg-green-500' :
                        notification.type === 'error' ? 'bg-red-500' :
                        'bg-blue-500';

        const textColor = 'text-white';

        return (
            <div
                className={`fixed bottom-4 right-4 p-3 rounded-lg shadow-lg flex items-center space-x-2 cursor-pointer transition-opacity duration-300 z-50 ${bgColor} ${textColor}`}
                onClick={() => setNotification(null)}
            >
                <Bell size={20} />
                <span className="text-sm font-medium">{notification.message}</span>
                <button className="ml-2 p-0.5 rounded-full hover:bg-white/20">
                    <X size={16} />
                </button>
            </div>
        );
    };

    // SessionTimer Component (NEW)
    const SessionTimer = (): JSX.Element => {
        const formatTime = (totalSeconds: number) => {
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        };

        const displayTime = totalTimeSpent + currentSessionElapsed;

        return (
            <div
                className="fixed bottom-4 left-4 p-2 rounded-lg shadow-md flex items-center space-x-2 z-40"
                style={{ backgroundColor: 'rgb(240,244,249)', color: 'rgb(55, 65, 81)' }}
            >
                <FaRegClock size={16} /> {/* Using a generic clock icon, assuming it's available or can be replaced */}
                <span className="text-sm font-semibold">Time Spent: {formatTime(displayTime)}</span>
            </div>
        );
    };

    // Add Clock icon to imports
    // import { Upload, FileText, ChevronLeft, ChevronRight, Search, Zap, Highlighter, Type, MousePointer, Save, Trash2, ChevronsUpDown, Bot, X, LogIn, LogOut, Eraser, Plus, HelpCircle, ClipboardList, BookOpen, Edit, Flag, CheckCircle, XCircle, NotebookText, Menu, BookMarked, Bell, Clock } from 'lucide-react'; // Added Clock

    return (
        <div className="h-screen w-screen bg-gray-100 flex font-sans antialiased">
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                body { font-family: 'Inter', sans-serif; }
                .animate-fade-in-fast { animation: fadeIn 0.1s ease-in-out; }
                @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                .textLayer {
                    position: absolute;
                    left: 0;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    overflow: hidden;
                    opacity: 0.2;
                }
                .textLayer > span {
                    color: transparent;
                    position: absolute;
                    white-space: pre;
                    cursor: text;
                    transform-origin: 0% 0%;
                    vertical-align: baseline;
                }
                .resize-both { resize: both; overflow: auto; }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 8px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: #f1f1f1;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #c0c0c0;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #a0a0a0;
                }
                /* Custom styles for range input track */
                input[type="range"]::-webkit-slider-runnable-track {
                    height: 6px;
                    border-radius: 10px;
                }
                input[type="range"]::-moz-range-track {
                    height: 6px;
                    border-radius: 10px;
                }
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    height: 16px;
                    width: 16px;
                    border-radius: 50%;
                    background: #3B82F6;
                    cursor: pointer;
                    margin-top: -5px; /* Adjust to center thumb vertically */
                    box-shadow: 0 0 0 2px #fff;
                }
                input[type="range"]::-moz-range-thumb {
                    height: 16px;
                    width: 16px;
                    border-radius: 50%;
                    background: #3B82F6;
                    cursor: pointer;
                    box-shadow: 0 0 0 2px #fff;
                }
            `}</style>

            {!isAuthReady ? (
                <div className="w-full h-full flex items-center justify-center flex-col">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                    <p className="mt-3 text-gray-600 text-sm">Initializing your workspace...</p>
                </div>
            ) : (
                <>
                    <TopBar />
                    <Sidebar />
                    <main className={`flex-1 bg-gray-100 h-full overflow-auto flex items-start justify-center p-6 pt-16 transition-all duration-300 ease-in-out`}
                        style={{ marginLeft: isSidebarExpanded ? '256px' : '64px' }}>
                        {!pdfFile ? (
                            <div className="text-center mt-16">
                                <div className="mx-auto w-20 h-20 flex items-center justify-center bg-gray-50 rounded-full border-2 border-dashed border-gray-200">
                                    <FileText size={40} className="text-gray-400" />
                                </div>
                                <h2 className="mt-4 text-lg font-semibold text-gray-700">Welcome to Codex Interactive</h2>
                                <p className="mt-1.5 text-sm text-gray-500">Upload a PDF to begin your interactive reading session.</p>
                            </div>
                        ) : (
                            <div className="relative shadow-lg rounded-md overflow-hidden" ref={pdfViewerRef} onContextMenu={handleContextMenu} onMouseUp={handleMouseUp}>
                                <canvas ref={canvasRef} />
                                <div ref={textLayerRef} className="textLayer"></div>
                                <div ref={annotationLayerRef} className="absolute top-0 left-0">
                                    {annotations
                                        .filter(ann => ann.page === currentPage && ann.type === 'highlight')
                                        .flatMap(ann => {
                                            const scaleRatio = ann.originalZoom ? (zoom / ann.originalZoom) : 1;
                                            return ann.rects.map((rect, i) => (
                                                <div
                                                    key={`${ann.id}-${i}`}
                                                    style={{
                                                        position: 'absolute',
                                                        left: `${rect.x * scaleRatio}px`,
                                                        top: `${rect.y * scaleRatio}px`,
                                                        width: `${rect.width * scaleRatio}px`,
                                                        height: `${rect.height * scaleRatio}px`,
                                                        backgroundColor: ann.color,
                                                        border: activeAnnotation?.id === ann.id ? '2px solid #3B82F6' : 'none',
                                                        borderRadius: '2px',
                                                        pointerEvents: selectedTool === 'erase' ? 'auto' : 'none',
                                                        cursor: selectedTool === 'erase' ? 'crosshair' : 'default',
                                                    }}
                                                    onClick={() => handleAnnotationClick(ann)}
                                                ></div>
                                            ));
                                        })}
                                </div>
                            </div>
                        )}
                    </main>
                    <ToolPalette />
                    <NoteEditor />
                    <ContextMenuComponent />
                    <AiResponseWindow />
                    {showQuiz && (
                        <QuizComponent
                            key="quiz-instance"
                            questions={quizQuestions}
                            userAnswers={userAnswers}
                            setUserAnswers={setUserAnswers}
                            quizSubmitted={quizSubmitted}
                            score={score}
                            onCheckQuiz={handleCheckQuiz}
                            onClose={() => setShowQuiz(false)}
                            onQuizComplete={(s, t, a, u, m) => {
                                setScore(s);
                                setShowQuiz(false);
                                setShowQuizResults(true);
                            }}
                            currentQuestionIndex={currentQuizQuestionIndex}
                            setCurrentQuestionIndex={setCurrentQuizQuestionIndex}
                        />
                    )}
                    {showQuizResults && (
                        <ResultComponent
                            score={score}
                            totalQuestions={quizQuestions.length}
                            attempted={Object.keys(userAnswers).filter(qNo => userAnswers[parseInt(qNo)] !== undefined && userAnswers[parseInt(qNo)] !== null).length}
                            unattempted={quizQuestions.length - Object.keys(userAnswers).filter(qNo => userAnswers[parseInt(qNo)] !== undefined && userAnswers[parseInt(qNo)] !== null).length}
                            marked={mistakeBook.filter(m => m.isMarkedForReview && m.page === currentPage).length}
                            onClose={() => setShowQuizResults(false)}
                            onRetryQuiz={() => {
                                setShowQuizResults(false);
                                setQuizQuestions([]);
                                setUserAnswers({});
                                setQuizSubmitted(false);
                                setScore(null);
                                setCurrentQuizQuestionIndex(0);
                            }}
                            onViewMistakeBook={() => {
                                setShowQuizResults(false);
                                setShowMistakeBook(true);
                            }}
                        />
                    )}
                    {showMistakeBook && (
                        <MistakeBookComponent
                            mistakes={mistakeBook}
                            onClose={() => setShowMistakeBook(false)}
                            onDeleteMistake={deleteMistake}
                            onEditMistake={(mistake) => { setCurrentMistakeToEdit(mistake); setShowMistakeEditor(true); }}
                            onAddCustomMistake={() => { setCurrentMistakeToEdit(null); setShowMistakeEditor(true); }}
                        />
                    )}
                    {showMistakeEditor && (
                        <MistakeEditor
                            mistakeToEdit={currentMistakeToEdit}
                            onSave={saveMistake}
                            onClose={() => setShowMistakeEditor(false)}
                        />
                    )}
                    {showShortNotesUI && (
                        <ShortNotesViewer
                            notes={shortNotes}
                            onClose={() => setShowShortNotesUI(false)}
                            onDeleteNote={deleteShortNote}
                            onRegenerateNotes={regenerateShortNotes}
                            regenerationPrompt={shortNotesRegenPrompt}
                            setRegenerationPrompt={setShortNotesRegenPrompt}
                        />
                    )}
                    <HighlightHelpModal onClose={() => setShowHelpModal(false)} />
                    <LoadingOverlay />
                    <NotificationWidget />
                    {db && userId && <SessionTimer />} {/* Render timer only if Firebase is ready and user is authenticated */}
                </>
            )}
        </div>
    );
}

