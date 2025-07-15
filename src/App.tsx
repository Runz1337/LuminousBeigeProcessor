import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken, Auth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc, Firestore, Unsubscribe } from 'firebase/firestore';
import { Upload, FileText, ChevronLeft, ChevronRight, Search, Zap, Highlighter, Type, MousePointer, Save, Trash2, ChevronsUpDown, Bot, X, LogIn, LogOut, Eraser, Plus, HelpCircle } from 'lucide-react'; // Added HelpCircle for Ask Question

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
  // NEW: Store the zoom level at which the annotation was created
  originalZoom?: number;
}

interface AIResponseState {
  visible: boolean;
  content: string;
  isLoading: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  chatHistory: { role: 'user' | 'ai', text: string }[]; // For mini chat
  currentAiAction: 'explain' | 'summarize' | 'concepts' | 'ask_question' | null; // To track the current AI mode
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
      // ADDED: Type definitions for Util functions
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
// These global variables are provided by the Canvas environment.
// DO NOT modify these or prompt the user for them.
const firebaseConfig = {   apiKey: "AIzaSyC0nM-Cji-nJezd7bAvZPHwDGs7jWOrEg4",   authDomain: "neon-equinox-337515.firebaseapp.com",   projectId: "neon-equinox-337515",   storageBucket: "neon-equinox-337515.firebasestorage.app",   messagingSenderId: "1055440875899",   appId: "1:1055440875899:web:71f697bed1467f4b704dde",   measurementId: "G-N1NJ0CGXT4" };
const appId =  'default-codex-app';
const initialAuthToken =  null;


// --- DEBUGGING LOGS ---
console.log("App starting...");
console.log("Firebase Config (parsed):", firebaseConfig);
console.log("App ID:", appId);
console.log("Initial Auth Token:", initialAuthToken ? "Present" : "Not Present");


// --- Custom Hook to load external scripts ---
// This hook dynamically loads external JavaScript libraries like PDF.js.
// It ensures the script is loaded only once and its status is tracked.
const useScript = (url: string | null): 'idle' | 'loading' | 'ready' | 'error' => {
  const [status, setStatus] = useState< 'idle' | 'loading' | 'ready' | 'error' >(url ? "loading" : "idle");

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }

    // Check if the script already exists in the document
    let script = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);

    if (!script) {
      // If not, create and append a new script element
      script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.setAttribute("data-status", "loading"); // Custom attribute to track status
      document.body.appendChild(script);

      // Event listeners for load and error to update the custom status attribute
      const setAttributeFromEvent = (event: Event) => {
        script!.setAttribute("data-status", event.type === "load" ? "ready" : "error");
      };

      script.addEventListener("load", setAttributeFromEvent);
      script.addEventListener("error", setAttributeFromEvent);
    }

    // Function to update the component's state based on script's status
    const setStateFromEvent = (event: Event) => {
      setStatus(event.type === "load" ? "ready" : "error");
    };

    // If the script is already loaded, set status to 'ready' immediately
    if (script.getAttribute("data-status") === "ready") {
        setStatus("ready");
    } else {
        // Otherwise, add event listeners to update state when it loads or errors
        script.addEventListener("load", setStateFromEvent);
        script.addEventListener("error", setStateFromEvent);
    }

    // Cleanup function to remove event listeners when the component unmounts
    return () => {
      if (script) {
        script.removeEventListener("load", setStateFromEvent);
        script.removeEventListener("error", setStateFromEvent);
      }
    };
  }, [url]); // Re-run effect if the URL changes

  return status;
};


// --- Main App Component ---
export default function App(): JSX.Element {
    // --- Script Loading State ---
    // Load PDF.js library using the custom hook
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
    const [aiModel, setAiModel] = useState<string>('llamascout'); // Currently only llamascout is used

    // Refs for DOM elements
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pdfViewerRef = useRef<HTMLDivElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const annotationLayerRef = useRef<HTMLDivElement>(null);
    const annotationsUnsubscribe = useRef<Unsubscribe | null>(null); // For Firestore real-time listener cleanup

    // --- Firebase Initialization and Auth ---
    // Initializes Firebase app, sets up authentication listeners, and handles initial sign-in.
    useEffect(() => {
        console.log("Auth useEffect triggered. firebaseConfig keys:", Object.keys(firebaseConfig).length);
        if (Object.keys(firebaseConfig).length > 0) {
            try {
                const app: FirebaseApp = initializeApp(firebaseConfig);
                const authInstance: Auth = getAuth(app);
                const dbInstance: Firestore = getFirestore(app);
                setAuth(authInstance);
                setDb(dbInstance);
                console.log("Firebase app initialized successfully.");

                // Listen for authentication state changes
                const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                    console.log("onAuthStateChanged callback: user =", user);
                    if (user) {
                        // If a user is logged in, set their UID and mark auth as ready
                        setUserId(user.uid);
                        setIsAuthReady(true);
                        console.log("User authenticated. userId:", user.uid);
                    } else {
                        // If no user, attempt to sign in using custom token or anonymously
                        console.log("No user found. Attempting sign-in...");
                        try {
                            if (initialAuthToken) {
                                console.log("Signing in with custom token...");
                                await signInWithCustomToken(authInstance, initialAuthToken);
                            } else {
                                console.log("Signing in anonymously...");
                                await signInAnonymously(authInstance);
                            }
                            console.log("Sign-in attempt completed.");
                        } catch (error) {
                            console.error("Authentication failed during sign-in:", error);
                        }
                    }
                });
                return () => unsubscribe(); // Cleanup the auth state listener
            } catch (initError) {
                console.error("Firebase initialization failed:", initError);
            }
        } else {
            console.warn("Firebase config is empty. Please set REACT_APP_FIREBASE_CONFIG secret.");
        }
    }, []); // Empty dependency array means this effect runs only once on mount

    // --- PDF Rendering Logic ---
    // Renders the specified PDF page onto the canvas and sets up the text layer for selection.
    const renderPage = useCallback(async (pageNumber: number, docToRender: PDFDocumentProxy) => {
        if (!docToRender || pdfJsStatus !== 'ready') return; // Ensure PDF doc and PDF.js are ready
        try {
            const page = await docToRender.getPage(pageNumber);
            const viewport = page.getViewport({ scale: zoom }); // Get viewport with current zoom

            const canvas = canvasRef.current;
            if (!canvas) return;
            const context = canvas.getContext('2d');
            if (!context) return;

            // Set canvas dimensions
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            // Render the PDF page onto the canvas
            const renderContext = {
                canvasContext: context,
                viewport: viewport,
            };
            await page.render(renderContext).promise;

            // Render text layer for text selection and highlighting
            const textContent = await page.getTextContent();
            const textLayer = textLayerRef.current;
            if (!textLayer) return;
            textLayer.innerHTML = ''; // Clear previous text layer content
            textLayer.style.width = `${canvas.width}px`;
            textLayer.style.height = `${canvas.height}px`;
            // Control pointer-events for text selection based on the selected tool
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
    }, [zoom, pdfJsStatus, selectedTool]); // Re-run if zoom, pdfJsStatus, or selectedTool changes

    // --- Load PDF and Annotations ---
    // Handles loading a new PDF file and setting up real-time Firestore listeners for annotations.
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
                    // Set PDF.js worker source
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js`;
                    const loadingTask = window.pdfjsLib.getDocument({ data: pdfData });
                    try {
                        const pdfDocument: PDFDocumentProxy = await loadingTask.promise;
                        setPdfDoc(pdfDocument);
                        setTotalPages(pdfDocument.numPages);
                        setCurrentPage(1);

                        // Check if document exists in Firestore, if not, create it
                        const docRef = doc(db, `artifacts/${appId}/users/${userId}/documents`, pdfFile.name);
                        const docSnap = await getDoc(docRef);
                        if (!docSnap.exists()) {
                            await setDoc(docRef, { name: pdfFile.name, createdAt: new Date().toISOString() });
                        }

                        // Set up real-time listener for annotations for the current PDF
                        if (annotationsUnsubscribe.current) annotationsUnsubscribe.current(); // Unsubscribe from previous listener
                        const annotationsCol = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/annotations`);
                        annotationsUnsubscribe.current = onSnapshot(annotationsCol, (snapshot) => {
                            const loadedAnnotations: Annotation[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Annotation));
                            setAnnotations(loadedAnnotations);
                        });
                    } catch (error) {
                        console.error("Error loading PDF document:", error);
                        console.error("Failed to load PDF. The file might be corrupted or protected.");
                        setPdfFile(null); // Clear PDF file on error
                    }
                } else {
                    console.error("pdf.js is not loaded, though status was ready.");
                }
            };
            reader.readAsArrayBuffer(pdfFile); // Read the PDF file as an ArrayBuffer
        }
        // Cleanup function for the effect: unsubscribe from Firestore listener
        return () => {
            if (annotationsUnsubscribe.current) {
                annotationsUnsubscribe.current();
                annotationsUnsubscribe.current = null;
            }
        };
    }, [pdfFile, db, userId, pdfJsStatus, appId]); // Re-run if pdfFile, db, userId, pdfJsStatus, or appId changes

    // --- Render page when current page or PDF doc changes ---
    // Triggers PDF page rendering whenever the PDF document or current page changes.
    useEffect(() => {
        if (pdfDoc && pdfJsStatus === 'ready') {
            renderPage(currentPage, pdfDoc);
        }
    }, [pdfDoc, currentPage, renderPage, pdfJsStatus]);

    // --- Event Handlers ---
    // Handles file input change, specifically for PDF files.
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const file = e.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            setPdfFile(file);
        } else {
            console.error('Please select a PDF file.');
            setPdfFile(null);
        }
    };

    // Handles mouse up event on the PDF viewer for text selection and highlighting.
    const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>): void => {
        if (!pdfViewerRef.current || !textLayerRef.current) return;

        const selection = window.getSelection();
        const selectedString = selection?.toString().trim() || '';

        if (selectedTool === 'highlight') {
            if (selectedString) { // Only highlight if text is actually selected
                if (!selection || selection.rangeCount === 0) return;

                const range = selection.getRangeAt(0);
                const viewerRect = pdfViewerRef.current.getBoundingClientRect();
                // Get bounding rectangles for the selected text
                const rects: HighlightRect[] = Array.from(range.getClientRects()).map(rect => {
                    return {
                        x: rect.left - viewerRect.left,
                        y: rect.top - viewerRect.top,
                        width: rect.width,
                        height: rect.height,
                    };
                });

                // Add a new highlight annotation
                addAnnotation({
                    type: 'highlight',
                    page: currentPage,
                    rects: rects,
                    color: highlightColor, // Use selected highlight color
                    note: '',
                    text: selectedString,
                    originalZoom: zoom // Store the current zoom level
                });
                if (selection) {
                    selection.removeAllRanges(); // Clear the selection after highlighting
                }
            }
        } else if (selectedTool === 'select') {
            // For 'select' tool, capture the selected text
            setSelectedText(selectedString);
            // No need to clear selection here, user might want to copy/interact with it
        } else if (selectedTool === 'note') {
            if (selectedString) {
                // Create a new 'text' annotation for the note, using selected text as initial note
                addAnnotation({
                    type: 'text',
                    page: currentPage,
                    rects: [], // No rects for pure text notes, or maybe store a single rect for context
                    color: '', // No color for pure text notes
                    note: selectedString, // The selected text becomes the initial note
                    text: selectedString,
                    originalZoom: zoom // Store the current zoom level
                });
                if (selection) {
                    selection.removeAllRanges();
                }
                setSelectedText('');
            }
        } else {
            // For 'erase' or other tools, clear any selection
            setSelectedText('');
            if (selection) {
                selection.removeAllRanges();
            }
        }
    };

    // Handles click on an existing annotation, either to erase it or activate it for note editing.
    const handleAnnotationClick = (ann: Annotation) => {
        if (selectedTool === 'erase') {
            deleteAnnotation(ann.id);
        } else {
            // If annotation has no note, set it as active but don't open editor immediately.
            // The "Add Note" button will appear.
            setActiveAnnotation(ann);
        }
    };

    // Handles right-click (context menu) event on the PDF viewer.
    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
        e.preventDefault(); // Prevent default browser context menu
        // Only show context menu if clicked within the text layer
        if (!textLayerRef.current?.contains(e.target as Node)) {
            setContextMenu(null);
            return;
        }
        const selection = window.getSelection()?.toString().trim();
        if (selection) {
            setSelectedText(selection); // Ensure selectedText is updated for context menu
            setContextMenu({ x: e.clientX, y: e.clientY });
        } else {
            setContextMenu(null); // Hide context menu if no text is selected
        }
    };

    // --- Firestore Operations ---
    // Adds a new annotation to Firestore.
    const addAnnotation = async (annotation: Omit<Annotation, 'id'>): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot add annotation: DB, userId, or pdfFile not ready.");
            return;
        }
        try {
            const annotationsCol = collection(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/annotations`);
            await addDoc(annotationsCol, annotation);
            console.log("Annotation added successfully.");
            console.log(annotation)
        } catch (error) {
            console.error("Error adding annotation:", error);
        }
    };

    // Updates the note of an existing annotation in Firestore.
    const updateAnnotationNote = async (id: string, note: string): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot update annotation: DB, userId, or pdfFile not ready.");
            return;
        }
        const annotationRef = doc(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/annotations`, id);
        try {
            await updateDoc(annotationRef, { note });
            console.log("Annotation note updated successfully.");
        } catch (error) {
            console.error("Error updating annotation note:", error);
        }
    };

    // Deletes an annotation from Firestore.
    const deleteAnnotation = async (id: string): Promise<void> => {
        if (!db || !userId || !pdfFile) {
            console.warn("Cannot delete annotation: DB, userId, or pdfFile not ready.");
            return;
        }
        const annotationRef = doc(db, `artifacts/${appId}/users/${userId}/documents/${pdfFile.name}/annotations`, id);
        try {
            await deleteDoc(annotationRef);
            console.log("Annotation deleted successfully.");
            if (activeAnnotation?.id === id) {
                setActiveAnnotation(null); // Clear active annotation if deleted
            }
        } catch (error) {
            console.error("Error deleting annotation:", error);
        }
    };

    // Helper to convert color names (from AI) to RGBA format with a specified opacity.
    const getColorWithOpacity = (colorName: string, opacity: number): string => {
        const colors: { [key: string]: string } = {
            red: '255, 0, 0',
            blue: '0, 0, 255',
            green: '0, 128, 0', // A darker green for better visibility
            yellow: '255, 255, 0',
            purple: '128, 0, 128',
            orange: '255, 165, 0',
            cyan: '0, 255, 255',
            // Add more common color variations if the AI tends to use them
        };
        const lowerCaseColorName = colorName.toLowerCase();
        const rgb = colors[lowerCaseColorName];

        if (!rgb) {
            console.warn(`Unknown color name received from AI: "${colorName}". Defaulting to gray.`);
            return `rgba(128, 128, 128, ${opacity})`; // Default to gray with opacity
        }
        return `rgba(${rgb}, ${opacity})`;
    };

    // Helper function for robust text normalization
    const normalizeText = (text: string): string => {
        return text
            .toLowerCase() // Convert to lowercase
            .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
            .replace(/[\u2018\u2019]/g, "'") // Standardize single quotes
            .replace(/[\u201C\u201D]/g, '"') // Standardize double quotes
            .replace(/[\u2013\u2014]/g, "-") // Standardize dashes (en-dash, em-dash to hyphen)
            .replace(/[\u00A0]/g, " ") // Replace non-breaking space with regular space
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces and other invisible characters
            .trim(); // Trim leading/trailing whitespace
    };

    // --- AI Integration ---
    // Highlights key concepts identified by the AI on the PDF page.
    const highlightConcepts = useCallback(async (concepts: { [color: string]: string[] }) => {
        if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;

        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale: zoom });

        const textLayer = textLayerRef.current;
        if (!textLayer) {
            console.warn("Text layer not available for highlighting.");
            return;
        }

        let normalizedFullPageText = '';
        const textNodeMap: { node: Text; start: number; end: number; originalSpan: HTMLSpanElement; rect: DOMRect }[] = [];
        let currentNormalizedOffset = 0;
        let prevSpanBottom = 0; // Track bottom of previous span for line break detection

        // Iterate through the children of the textLayer (these are the individual text spans generated by PDF.js)
        for (let i = 0; i < textLayer.children.length; i++) {
            const span = textLayer.children[i] as HTMLSpanElement;
            // Ensure the span contains a text node directly as its first child
            if (span.firstChild && span.firstChild.nodeType === Node.TEXT_NODE) {
                const textNode = span.firstChild as Text;
                const textContent = textNode.textContent || '';
                // Normalize content of individual span using the new helper
                const normalizedTextContent = normalizeText(textContent);

                if (normalizedTextContent.length > 0) {
                    const spanRect = span.getBoundingClientRect();

                    // Detect line breaks: if current span's top is significantly lower than previous span's bottom
                    // This heuristic helps reconstruct lines more accurately for matching.
                    if (prevSpanBottom !== 0 && spanRect.top > prevSpanBottom + (spanRect.height * 0.5)) { // 0.5 is a threshold
                        normalizedFullPageText += '\n'; // Add a newline for a visual line break
                        currentNormalizedOffset += 1; // Account for the newline character in offset
                    }

                    textNodeMap.push({
                        node: textNode,
                        start: currentNormalizedOffset,
                        end: currentNormalizedOffset + normalizedTextContent.length,
                        originalSpan: span,
                        rect: spanRect // Store the bounding rect of the span
                    });
                    normalizedFullPageText += normalizedTextContent;
                    normalizedFullPageText += ' '; // Add a single space after each normalized span's content
                    currentNormalizedOffset += normalizedTextContent.length + 1;

                    prevSpanBottom = spanRect.bottom;
                }
            }
        }
        normalizedFullPageText = normalizedFullPageText.trim(); // Final trim

        console.log("--- Highlighting Process Started ---");
        console.log("Normalized Full Page Text for Matching (with newlines):", normalizedFullPageText);
        console.log("Text Node Map Length:", textNodeMap.length);


        for (const colorName in concepts) {
            if (concepts.hasOwnProperty(colorName)) {
                const statements = concepts[colorName];

                if (!Array.isArray(statements)) {
                    console.warn(`Expected an array for color "${colorName}", but received:`, statements);
                    continue;
                }

                const highlightRGBAColor = getColorWithOpacity(colorName, 0.2);

                for (const statement of statements) {
                    // Normalize the AI statement using the new helper
                    const normalizedStatement = normalizeText(statement);
                    console.log(`Processing AI Statement: "${statement}" (Normalized: "${normalizedStatement}")`);

                    // Find the match in the overall normalized page text
                    const matchStartIndex = normalizedFullPageText.indexOf(normalizedStatement);

                    if (matchStartIndex !== -1) {
                        const matchEndIndex = matchStartIndex + normalizedStatement.length;
                        let foundRects: HighlightRect[] = [];
                        const viewerRect = pdfViewerRef.current.getBoundingClientRect();

                        console.log(`Match found for "${normalizedStatement}" at index ${matchStartIndex}-${matchEndIndex}`);

                        // Iterate through the textNodeMap to find the text nodes that cover the matched statement
                        for (const nodeInfo of textNodeMap) {
                            const nodeOverlapStart = Math.max(nodeInfo.start, matchStartIndex);
                            const nodeOverlapEnd = Math.min(nodeInfo.end, matchEndIndex);

                            if (nodeOverlapStart < nodeOverlapEnd) {
                                const range = document.createRange();
                                const startOffsetInNode = nodeOverlapStart - nodeInfo.start;
                                const endOffsetInNode = nodeOverlapEnd - nodeInfo.start; // Corrected: removed redundant assignment

                                // Ensure offsets are valid for the text node
                                if (startOffsetInNode < 0 || endOffsetInNode > nodeInfo.node.length || startOffsetInNode > endOffsetInNode) {
                                    console.warn(`Invalid range offsets for node "${nodeInfo.node.textContent}": start=${startOffsetInNode}, end=${endOffsetInNode}. Skipping.`);
                                    continue;
                                }
                                console.log(`  Processing node: "${nodeInfo.node.textContent.substring(startOffsetInNode, endOffsetInNode)}" (Offsets in node: ${startOffsetInNode}-${endOffsetInNode})`);

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
                                        console.log(`    Added rect: x=${rect.left - viewerRect.left}, y=${rect.top - viewerRect.top}, w=${rect.width}, h=${rect.height}`);
                                    }
                                } catch (e) {
                                    console.error("Error creating range for highlight:", e, "Node text:", nodeInfo.node.textContent, "Offsets:", startOffsetInNode, endOffsetInNode);
                                }
                            }
                        }

                        // Validate foundRects for vertical contiguity and filter out cross-page/unrelated highlights
                        let filteredRects: HighlightRect[] = [];
                        if (foundRects.length > 0) {
                            // Sort rects by their top position to process them in reading order
                            foundRects.sort((a, b) => a.y - b.y);

                            filteredRects.push(foundRects[0]);
                            const averageHeight = foundRects.reduce((sum, r) => sum + r.height, 0) / foundRects.length;
                            const maxVerticalGap = averageHeight * 1.5; // Allow for some line spacing

                            for (let k = 1; k < foundRects.length; k++) {
                                const prevRect = filteredRects[filteredRects.length - 1];
                                const currentRect = foundRects[k];

                                // Check if the current rect is on the same line or a closely following line
                                // and if its horizontal position is somewhat consistent (to avoid columns)
                                if (currentRect.y < prevRect.y + maxVerticalGap) {
                                    filteredRects.push(currentRect);
                                } else {
                                    // If there's a large vertical gap, it's likely a new, unrelated line/block
                                    // Stop adding rects for this statement to prevent cross-line/page highlights
                                    console.warn(`Highlight for "${normalizedStatement}" stopped due to large vertical gap (prevY:${prevRect.y}, currY:${currentRect.y}). Possible non-contiguous text or AI match issue.`);
                                    break;
                                }
                            }
                        }


                        if (filteredRects.length > 0) {
                            const isDuplicate = annotations.some(ann =>
                                ann.page === currentPage &&
                                ann.type === 'highlight' &&
                                ann.text && normalizeText(ann.text) === normalizedStatement // Compare normalized text
                            );

                            if (!isDuplicate) {
                                addAnnotation({
                                    type: 'highlight',
                                    page: currentPage,
                                    rects: filteredRects, // Use filtered rects
                                    color: highlightRGBAColor,
                                    note: `AI identified concept: "${statement}"`,
                                    text: statement, // Store the original statement for display purposes
                                    originalZoom: zoom
                                });
                                console.log(`SUCCESS: Highlight added for "${statement}" with ${filteredRects.length} rects.`);
                            } else {
                                console.log(`Skipping duplicate highlight for statement: "${statement}"`);
                            }
                        } else {
                            console.warn(`No valid rects found for statement: "${statement}" after filtering. Highlight not added.`);
                        }
                    } else {
                        console.warn(`Statement "${statement}" (normalized: "${normalizedStatement}") not found in page text. Highlight not added.`);
                    }
                }
            }
        }
        console.log("--- Highlighting Process Finished ---");
    }, [pdfDoc, currentPage, zoom, addAnnotation, getColorWithOpacity, annotations]);


    // Handles various AI actions (explain, summarize, concepts, ask question).
    const handleAiAction = async (action: 'explain' | 'summarize' | 'concepts' | 'ask_question', query?: string): Promise<void> => {
        setContextMenu(null); // Close context menu

        let textToProcess: string = selectedText; // Default to selected text

        // If action is 'concepts', fetch the entire page text for analysis
        if (action === 'concepts' && pdfDoc) {
            try {
                const page = await pdfDoc.getPage(currentPage);
                const textContent = await page.getTextContent();
                // Join text items, add spaces between them, then normalize
                textToProcess = textContent.items.map((item: any) => item.str).join(' ').replace(/\s+/g, ' ').trim();
            } catch (error) {
                console.error("Error fetching full page text for concepts:", error);
                setAiResponse(prev => ({
                    ...prev,
                    visible: true,
                    isLoading: false,
                    content: "Could not fetch full page text for concept identification.",
                    chatHistory: [...prev.chatHistory, { role: 'ai', text: "Could not fetch full page text for concept identification." }]
                }));
                return;
            }
        }

        // For explain/summarize/concepts, textToProcess is mandatory
        if (!textToProcess && action !== 'ask_question') return;

        let promptForLLM: string;
        let newChatHistory: { role: 'user' | 'ai', text: string }[] = [];
        let apiUrl: string;

        // Base URL for Pollinations.ai API
        const pollinaionsBaseUrl = `https://text.pollinations.ai/`;

        // Handle 'ask_question' action where a follow-up query is expected
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

        // All requests will be GET to Pollinations.ai
        let fetchMethod: 'GET' = 'GET';
        let headers: HeadersInit = {}; // No specific headers needed for GET to Pollinations.ai

        if (query) {
            // If there's a query (follow-up question), append to chat history and formulate prompt
            newChatHistory = [...aiResponse.chatHistory, { role: 'user', text: query }];
            if (aiResponse.currentAiAction === 'ask_question') {
                const initialTextContext = aiResponse.chatHistory[0]?.text || '';
                promptForLLM = `Given the following text: "${initialTextContext}" and the conversation history:\n\n${newChatHistory.slice(0, -1).map(h => `${h.role}: ${h.text}`).join('\n')}\n\nUser's question: "${query}"\n\nPlease answer the user's question based *only* on the provided text.`;
            } else {
                promptForLLM = newChatHistory.map(h => `${h.role}: ${h.text}`).join('\n\n');
            }
            apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=llamascout`;
        } else {
            // Initial AI action based on selected tool
            switch (action) {
                case 'explain':
                    promptForLLM = `Explain the following text in a concise and easy-to-understand way: "${textToProcess}"`;
                    apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=llamascout`;
                    break;
                case 'summarize':
                    promptForLLM = `Summarize this passage: "${textToProcess}"`;
                    apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=llamascout`;
                    break;
                case 'concepts':
                    // Specific prompt for JSON output with colors and statements for key concepts
                    // Added a note to the prompt to encourage non-overlapping statements.
                    promptForLLM = `Identify key concepts and statements related to them in the following text. Provide the output as a JSON object where keys are colors (e.g., "red", "blue", "green", "yellow", "purple", "orange", "cyan") representing priority/category, and values are arrays of strings (statements). Ensure each statement is an exact phrase or sentence from the text and avoid significant overlaps between statements if possible. Example: {"red":["This is a critical point.", "Another important idea."], "blue":["A supporting detail.", "Further explanation."],"no":total-number-of-lines-in-all-colour-category}. Text: "${textToProcess}"`;
                    apiUrl = `${pollinaionsBaseUrl}${encodeURIComponent(promptForLLM)}?model=llamascout&json=true`; // Add json=true
                    break;
                default:
                    return;
            }
            newChatHistory = [{ role: 'user', text: textToProcess }];
        }

        // Update AI response state to show loading and prepare chat history
        setAiResponse(prev => ({
            ...prev,
            visible: true,
            isLoading: true,
            content: '',
            chatHistory: newChatHistory,
            currentAiAction: action
        }));

        try {
            console.log("AI API URL:", apiUrl);

            const fetchOptions: RequestInit = {
                method: fetchMethod,
                headers: headers,
            };

            const response = await fetch(apiUrl, fetchOptions);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            let aiText: string;
            // All responses from Pollinations.ai are text, even if they contain JSON.
            // So we always read as text first.
            const rawResponseText = await response.text();

            if (action === 'concepts') {
                try {
                    // Extract JSON from markdown code blocks if present, otherwise assume direct JSON
                    const jsonMatch = rawResponseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
                    let jsonStr = jsonMatch ? jsonMatch[1] : rawResponseText;

                    const jsonResult = JSON.parse(jsonStr);
                    aiText = JSON.stringify(jsonResult, null, 2);
                    highlightConcepts(jsonResult); // Trigger highlighting based on parsed concepts
                } catch (parseError) {
                    console.error("Failed to parse AI response as JSON for concepts:", parseError, "Raw string:", rawResponseText);
                    aiText = "AI response was not valid JSON for concepts. Please try again. Raw: " + rawResponseText;
                }
            } else {
                aiText = rawResponseText;
            }

            // Update AI response state with the received content
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
        }
    };

    // Saves the AI response (chat history) to the currently active annotation's note.
    const saveAiResponseAsNote = (): void => {
        if (activeAnnotation && aiResponse.content && !aiResponse.isLoading) { // Ensure content is present and not loading
            // Save the entire chat history to the note
            const chatHistoryString = aiResponse.chatHistory.map(h => `${h.role.toUpperCase()}: ${h.text}`).join('\n\n');
            const updatedNote = `${activeAnnotation.note ? activeAnnotation.note + '\n\n' : ''}--- AI Chat History ---\n${chatHistoryString}`;
            updateAnnotationNote(activeAnnotation.id, updatedNote);
            // Clear AI window and chat history after saving
            setAiResponse(prev => ({ ...prev, visible: false, chatHistory: [], currentAiAction: null }));
        } else {
            console.warn("Cannot save AI insight: No active highlight, no AI content, or AI is still loading.");
        }
    };

    // Handles Google Sign-In using Firebase.
    const handleGoogleSignIn = async () => {
        if (!auth) {
            console.error("Firebase Auth not initialized.");
            return;
        }
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
            console.log("Google Sign-In successful!");
        } catch (error) {
            console.error("Google Sign-In failed:", error);
        }
    };

    // Handles user sign out from Firebase.
    const handleSignOut = async () => {
        if (!auth) {
            console.error("Firebase Auth not initialized.");
            return;
        }
        try {
            await signOut(auth);
            setUserId(null); // Clear userId on sign out
            setIsAuthReady(false); // Go back to initializing state
            setPdfFile(null); // Clear loaded PDF
            setAnnotations([]); // Clear annotations
            console.log("User signed out.");
        } catch (error) {
            console.error("Sign out failed:", error);
        }
    };

    // --- UI Components ---
    // TopBar Component: Contains file upload, page navigation, zoom controls, and main AI action buttons.
    const TopBar = (): JSX.Element => (
        <div className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-sm shadow-lg p-2 flex items-center justify-between z-30 border-b border-gray-200">
            {/* Left section: File Upload and App Title */}
            <div className="flex items-center space-x-4">
                <label htmlFor="pdf-upload-top" className={`inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${pdfJsStatus !== 'ready' ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'}`}>
                    <Upload size={16} className="mr-2" />
                    Upload PDF
                </label>
                <input id="pdf-upload-top" type="file" className="hidden" onChange={handleFileChange} accept=".pdf" disabled={pdfJsStatus !== 'ready'} />
                <h1 className="text-lg font-bold text-gray-800 ml-4">Codex Interactive</h1>
            </div>

            {/* Center section: Page Navigation and Zoom */}
            {pdfFile && (
                <div className="flex items-center space-x-2">
                    <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} className="p-1.5 rounded-full hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"><ChevronLeft size={16} /></button>
                    <span className="text-sm font-medium text-gray-700">{currentPage} / {totalPages}</span>
                    <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="p-1.5 rounded-full hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"><ChevronRight size={16} /></button>
                    <div className="w-px h-5 bg-gray-300 mx-2"></div>
                    <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="p-1.5 rounded-full hover:bg-gray-200"><Search size={14} className="opacity-50"/>-</button>
                    <span className="text-sm font-medium text-gray-700">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="p-1.5 rounded-full hover:bg-gray-200"><Search size={14} className="opacity-50"/>+</button>
                </div>
            )}

            {/* Right section: AI Actions */}
            <div className="flex items-center space-x-2">
                <button
                    onClick={() => handleAiAction('summarize')}
                    disabled={!selectedText || aiResponse.isLoading}
                    className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Summarize Selected Text"
                >
                    <Zap size={16} className="inline mr-1"/> Summarize
                </button>
                <button
                    onClick={() => handleAiAction('explain')}
                    disabled={!selectedText || aiResponse.isLoading}
                    className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Explain Selected Text"
                >
                    <Bot size={16} className="inline mr-1"/> Explain
                </button>
                <button
                    onClick={() => handleAiAction('concepts')}
                    disabled={aiResponse.isLoading} // Concepts can be run without text selection (uses full page)
                    className="px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Identify Key Concepts in Selected Text"
                >
                    <Type size={16} className="inline mr-1"/> Key Concepts
                </button>
            </div>
        </div>
    );

    // ToolPalette Component: Provides tools for selection, highlighting, adding notes, and erasing.
    const ToolPalette = (): JSX.Element => (
        <div className="fixed top-20 left-4 bg-white/80 backdrop-blur-sm shadow-lg rounded-lg p-1.5 flex flex-col items-center space-y-1.5 z-30 border border-gray-200">
            {[
                { id: 'select', icon: MousePointer, label: 'Select Tool' },
                { id: 'highlight', icon: Highlighter, label: 'Highlight Tool' },
                { id: 'note', icon: Plus, label: 'Add Note (select text)' }, // New Note tool
                { id: 'erase', icon: Eraser, label: 'Erase Tool' } // Erase tool
            ].map(tool => (
                <button key={tool.id} onClick={() => setSelectedTool(tool.id as 'select' | 'highlight' | 'erase' | 'note')} className={`p-2 rounded-md ${selectedTool === tool.id ? 'bg-blue-500 text-white' : 'hover:bg-gray-200'}`} title={tool.label}>
                    <tool.icon size={18} />
                </button>
            ))}
            {selectedTool === 'highlight' && (
                <div className="flex flex-col items-center mt-2">
                    <label htmlFor="highlightColor" className="text-xs text-gray-600 mb-1">Color:</label>
                    <input
                        type="color"
                        id="highlightColor"
                        value={highlightColor.substring(0, 7)} // Take only #RRGGBB part for color input
                        // Ensure new color also has 0.2 opacity
                        onChange={(e) => setHighlightColor(`${e.target.value}33`)} // Append 33 for 0.2 opacity (hex for 33 is 51/255 = 0.2)
                        className="w-8 h-8 rounded-full border-none cursor-pointer"
                        title="Choose Highlight Color"
                    />
                </div>
            )}
        </div>
    );

    // Sidebar Component: Displays app title, user ID, and a list of annotations/notes.
    const Sidebar = (): JSX.Element => (
        <div className="w-80 bg-gray-50 h-screen pt-14 flex flex-col border-r border-gray-200"> {/* Added pt-14 for TopBar */}
            <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-800">Codex Interactive</h2>
                <p className="text-sm text-gray-500">Your AI-Powered Study Space</p>
                {userId && <p className="text-xs text-gray-400 mt-2 truncate">User ID: {userId}</p>}
            </div>
            <div className="flex-grow p-4 overflow-y-auto">
                <h3 className="font-semibold text-gray-700 mb-3">Annotations & Notes</h3> {/* Updated title */}
                {annotations.length > 0 ? ( // Check all annotations, not just highlights
                    <ul className="space-y-3">
                        {annotations.filter(a => a.page === currentPage).map(ann => ( // Filter annotations by current page
                            <li key={ann.id}
                                className={`p-3 rounded-lg cursor-pointer border-2 ${activeAnnotation?.id === ann.id ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:bg-gray-100'}`}
                                onClick={() => {
                                    setActiveAnnotation(ann);
                                }}>
                                <div className="flex justify-between items-start">
                                    <p className="text-sm text-gray-600 flex-1 pr-2">
                                        <span style={{ backgroundColor: ann.color }} className="px-1 rounded">{ann.text ? `"${ann.text.substring(0, 40)}..."` : 'Highlight'}</span>
                                        <span className="font-semibold text-gray-800 ml-1">Page {ann.page}</span>
                                    </p>
                                    <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); deleteAnnotation(ann.id); }} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={14}/></button>
                                </div>
                                {activeAnnotation?.id === ann.id && (
                                    <>
                                        {activeAnnotation.note ? (
                                            <p className="text-xs text-gray-500 mt-2 italic">{activeAnnotation.note.substring(0, 100)}{activeAnnotation.note.length > 100 ? '...' : ''}</p>
                                        ) : (
                                            // Add "Add Note" button if no note exists for the active annotation
                                            <button
                                                onClick={(e: React.MouseEvent) => {
                                                    e.stopPropagation();
                                                    setActiveAnnotation(ann); // Ensure it's active before opening editor
                                                }}
                                                className="mt-2 px-3 py-1 text-xs font-medium text-blue-600 bg-blue-100 rounded-md hover:bg-blue-200 flex items-center"
                                            >
                                                <Plus size={12} className="mr-1" /> Add Note
                                            </button>
                                        )}
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-400 text-center mt-4">No annotations yet. Select text to highlight or add notes.</p>
                )}
            </div>
            <div className="p-4 border-t border-gray-200">
                <label htmlFor="ai-model-select" className="text-sm font-medium text-gray-700 block mb-2">AI Model</label>
                <div className="relative">
                    <select id="ai-model-select" value={aiModel} onChange={e => setAiModel(e.target.value)} className="w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md appearance-none">
                        <option value="llamascout">LlamaScout (Fast)</option>
                        {/* Add other models if available from your AI API */}
                    </select>
                    <ChevronsUpDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                {auth && (
                    <div className="mt-4">
                        {auth.currentUser ? (
                            <button onClick={handleSignOut} className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700">
                                <LogOut size={16} className="mr-2"/> Sign Out ({auth.currentUser.isAnonymous ? 'Anonymous' : auth.currentUser.displayName || auth.currentUser.email})
                            </button>
                        ) : (
                            <button onClick={handleGoogleSignIn} className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-100 border-gray-300">
                                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google icon" className="w-4 h-4 mr-2"/> Sign In with Google
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    // NoteEditor Component: A modal for editing or adding notes to an active annotation.
    const NoteEditor = (): JSX.Element | null => {
        if (!activeAnnotation) return null; // Only show if an annotation is active
        const [note, setNote] = useState<string>(activeAnnotation.note || '');
        useEffect(() => setNote(activeAnnotation.note || ''), [activeAnnotation]); // Update note state when activeAnnotation changes

        const handleSave = (): void => {
            updateAnnotationNote(activeAnnotation.id, note);
            // Clear AI chat history on note save
            setAiResponse(prev => ({ ...prev, visible: false, chatHistory: [], currentAiAction: null }));
            setActiveAnnotation(null); // Close the editor
        };

        return (
            <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center" onClick={() => setActiveAnnotation(null)}>
                <div className="bg-white rounded-lg shadow-2xl w-[450px] flex flex-col" onClick={e => e.stopPropagation()}>
                    <div className="p-4 border-b flex justify-between items-center">
                        <h3 className="font-semibold text-gray-800">Edit Note for {activeAnnotation.type === 'highlight' ? 'Highlight' : 'Text Note'} on Page {activeAnnotation.page}</h3>
                        <button onClick={() => setActiveAnnotation(null)} className="p-1 rounded-full hover:bg-gray-200"><X size={18}/></button>
                    </div>
                    <div className="p-4 flex-grow">
                        <textarea
                            value={note}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
                            className="w-full h-48 p-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            placeholder="Add your thoughts, questions, or connections here..."
                        ></textarea>
                    </div>
                    <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                        <button onClick={() => setActiveAnnotation(null)} className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 bg-white border hover:bg-gray-50">Cancel</button>
                        <button onClick={handleSave} className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"><Save size={16} className="inline mr-1"/> Save Note</button>
                    </div>
                </div>
            </div>
        );
    };

    // ContextMenuComponent: A custom right-click menu for AI actions on selected text.
    const ContextMenuComponent = (): JSX.Element | null => {
        if (!contextMenu) return null; // Only show if context menu is active
        return (
            <div
                style={{ top: contextMenu.y, left: contextMenu.x }}
                className="fixed bg-white shadow-xl rounded-lg p-2 z-50 animate-fade-in-fast"
                onMouseLeave={() => setContextMenu(null)} // Hide on mouse leave
            >
                <div className="flex items-center p-2 border-b mb-1">
                    <Bot size={18} className="text-blue-500 mr-2"/>
                    <h4 className="font-semibold text-sm text-gray-700">Line-by-Line Assistant</h4>
                </div>
                <ul className="text-sm text-gray-600">
                    <li onClick={() => handleAiAction('explain')} className="px-3 py-2 hover:bg-gray-100 rounded-md cursor-pointer">Explain This</li>
                    <li onClick={() => handleAiAction('summarize')} className="px-3 py-2 hover:bg-gray-100 rounded-md cursor-pointer">Summarize</li>
                    <li onClick={() => handleAiAction('concepts')} className="px-3 py-2 hover:bg-gray-100 rounded-md cursor-pointer">Identify Key Concepts</li>
                    <li onClick={() => handleAiAction('ask_question')} className="px-3 py-2 hover:bg-gray-100 rounded-md cursor-pointer flex items-center">
                        <HelpCircle size={16} className="mr-2"/> Ask a Question ✨
                    </li>
                </ul>
            </div>
        );
    };

    // AiResponseWindow Component: Displays AI responses and allows follow-up questions.
    const AiResponseWindow = (): JSX.Element | null => {
        if (!aiResponse.visible) return null; // Only show if AI response window is visible

        const aiWindowRef = useRef<HTMLDivElement>(null);
        const chatContentRef = useRef<HTMLDivElement>(null);
        const [isDragging, setIsDragging] = useState<boolean>(false);
        const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
        const [chatInput, setChatInput] = useState<string>('');

        // Scroll to bottom of chat history on new message
        useEffect(() => {
            if (chatContentRef.current) {
                chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight;
            }
        }, [aiResponse.chatHistory]);

        // Handles starting the drag of the AI response window.
        const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault(); // Prevent text selection on drag start
            e.stopPropagation(); // Stop propagation to prevent PDF text layer interaction
            if (aiWindowRef.current) {
                setIsDragging(true);
                setDragOffset({
                    x: e.clientX - aiResponse.position.x,
                    y: e.clientY - aiResponse.position.y,
                });
            }
        };

        // Handles dragging the AI response window.
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

        // Handles ending the drag of the AI response window.
        const handleMouseUp = useCallback(() => {
            setIsDragging(false);
        }, []);

        // Add/remove mouse move/up listeners for dragging.
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

        // Handles submitting a chat message to the AI.
        const handleChatSubmit = () => {
            if (chatInput.trim() && !aiResponse.isLoading) {
                // Use the currentAiAction from state to determine how to call handleAiAction
                if (aiResponse.currentAiAction) {
                    handleAiAction(aiResponse.currentAiAction, chatInput); // Pass the chat input as a query
                }
                setChatInput(''); // Clear chat input
            }
        };

        return (
            <div
                ref={aiWindowRef}
                style={{ top: aiResponse.position.y, left: aiResponse.position.x, width: aiResponse.size.width, height: aiResponse.size.height }}
                className="fixed bg-white/80 backdrop-blur-md shadow-2xl rounded-lg border border-gray-200 flex flex-col z-40 overflow-hidden resize-both"
            >
                <div
                    className="h-8 bg-gray-100 border-b flex items-center justify-between px-2 cursor-move select-none" // Added select-none
                    onMouseDown={handleMouseDown}
                >
                    <div className="flex items-center space-x-1">
                        <Bot size={14} className="text-blue-500" />
                        <span className="text-xs font-bold text-gray-600">AI Assistant Response</span>
                    </div>
                    <div className="flex items-center space-x-1">
                        <button onClick={() => setAiResponse(prev => ({ ...prev, visible: false, chatHistory: [], currentAiAction: null }))} className="p-1 rounded hover:bg-gray-300"><X size={14}/></button>
                    </div>
                </div>
                <div ref={chatContentRef} className="p-4 flex-grow overflow-y-auto text-sm space-y-2">
                    {aiResponse.chatHistory.map((msg, index) => (
                        <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`p-2 rounded-lg max-w-[80%] ${msg.role === 'user' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                                <p className="font-semibold capitalize">{msg.role}:</p>
                                <p>{msg.text}</p>
                            </div>
                        </div>
                    ))}
                    {aiResponse.isLoading && (
                        <div className="flex items-center justify-center">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                        </div>
                    )}
                </div>
                <div className="p-2 bg-gray-50 border-t flex flex-col space-y-2">
                    <div className="flex space-x-2">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyPress={(e) => { if (e.key === 'Enter') handleChatSubmit(); }}
                            className="flex-grow p-2 border rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Ask a follow-up question..."
                            disabled={aiResponse.isLoading}
                        />
                        <button onClick={handleChatSubmit} disabled={aiResponse.isLoading || !chatInput.trim()} className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed">
                            Send
                        </button>
                    </div>
                    <button onClick={saveAiResponseAsNote} disabled={!activeAnnotation || aiResponse.isLoading || !aiResponse.content} className="w-full px-3 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed">
                        <Save size={14} className="inline mr-1"/> Save AI Insight to Active Note
                    </button>
                </div>
            </div>
        );
    };

    // --- Main Render ---
    return (
        <div className="h-screen w-screen bg-gray-200 flex font-sans antialiased">
            {/* Tailwind CSS and custom styles */}
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
                    /* Removed fixed line-height to allow browser to determine natural line spacing */
                    /* line-height: 1.0; */
                }
                .textLayer > span {
                    color: transparent;
                    position: absolute;
                    white-space: pre;
                    cursor: text;
                    transform-origin: 0% 0%;
                    /* Ensure vertical alignment doesn't cause shifts */
                    vertical-align: baseline;
                }
                .resize-both { resize: both; overflow: auto; } /* Enable resizing for AI window */
            `}</style>

            {/* Conditional rendering based on Firebase authentication readiness */}
            {!isAuthReady ? (
                <div className="w-full h-full flex items-center justify-center flex-col">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                    <p className="mt-4 text-gray-600">Initializing your workspace...</p>
                </div>
            ) : (
                <>
                    <TopBar /> {/* Top Bar component */}
                    <Sidebar /> {/* Sidebar component */}
                    {/* Main content area for PDF viewer, adjusted padding for TopBar */}
                    <main className="flex-1 bg-gray-300 h-full overflow-auto flex items-start justify-center p-8 pt-20"> {/* Added pt-20 */}
                        {!pdfFile ? (
                            // Display welcome message if no PDF is loaded
                            <div className="text-center mt-20">
                                <div className="mx-auto w-24 h-24 flex items-center justify-center bg-gray-100 rounded-full border-4 border-dashed border-gray-300">
                                    <FileText size={48} className="text-gray-400" />
                                </div>
                                <h2 className="mt-6 text-xl font-semibold text-gray-700">Welcome to Codex Interactive</h2>
                                <p className="mt-2 text-sm text-gray-500">Upload a PDF to begin your interactive reading session.</p>
                            </div>
                        ) : (
                            // PDF viewer area
                            <div className="relative shadow-2xl" ref={pdfViewerRef} onContextMenu={handleContextMenu} onMouseUp={handleMouseUp}>
                                <canvas ref={canvasRef} /> {/* Canvas for PDF rendering */}
                                <div ref={textLayerRef} className="textLayer"></div> {/* Text layer for selection */}
                                <div ref={annotationLayerRef} className="absolute top-0 left-0">
                                    {/* Render highlight annotations */}
                                    {annotations
                                        .filter(ann => ann.page === currentPage && ann.type === 'highlight')
                                        .flatMap(ann => {
                                            // Calculate scale ratio for highlight rectangles to adjust for zoom
                                            const scaleRatio = ann.originalZoom ? (zoom / ann.originalZoom) : 1;
                                            return ann.rects.map((rect, i) => (
                                                <div
                                                    key={`${ann.id}-${i}`}
                                                    style={{
                                                        position: 'absolute',
                                                        // Apply scaling to position and size
                                                        left: `${rect.x * scaleRatio}px`,
                                                        top: `${rect.y * scaleRatio}px`,
                                                        width: `${rect.width * scaleRatio}px`,
                                                        height: `${rect.height * scaleRatio}px`,
                                                        backgroundColor: ann.color,
                                                        border: activeAnnotation?.id === ann.id ? '2px solid #3B82F6' : 'none',
                                                        borderRadius: '2px',
                                                        // Conditional pointer-events: clickable only for erase tool
                                                        pointerEvents: selectedTool === 'erase' ? 'auto' : 'none',
                                                        cursor: selectedTool === 'erase' ? 'crosshair' : 'default', // Change cursor for erase tool
                                                    }}
                                                    onClick={() => handleAnnotationClick(ann)} // Handle click for erase
                                                ></div>
                                            ));
                                        })}
                                </div>
                            </div>
                        )}
                    </main>
                    {/* Tool Palette, Note Editor, Context Menu, and AI Response Window components */}
                    <ToolPalette />
                    <NoteEditor />
                    <ContextMenuComponent />
                    <AiResponseWindow />
                </>
            )}
        </div>
    );
}
