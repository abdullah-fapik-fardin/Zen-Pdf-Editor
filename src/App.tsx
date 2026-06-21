import React, { useState, useEffect, useRef } from 'react';
import { Upload, X, Save, FileText, Loader2, LayoutTemplate, PenTool, Zap, ChevronLeft, ChevronRight, Check, Minus, Plus, Palette, Activity, AlignLeft, BarChart2, Type, Eraser, Undo2, Redo2, MousePointer2, Hand } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import * as pdfjsLib from 'pdfjs-dist';

// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

if (typeof window !== "undefined" && 'Worker' in window) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type EditEntry = {
  id: string;
  page: number;
  pdfX: number;
  pdfY: number;
  text: string;
  color: string;
  size: number;
  fontFamily: string;
  
  // Masking properties
  isReplacement: boolean;
  maskPdfX: number;
  maskPdfY: number;
  maskPdfW: number;
  maskPdfH: number;
};

type PdfTextItem = {
    str: string;
    pdfX: number;
    pdfY: number;
    pdfW: number;
    pdfH: number;
    fontSize: number;
    fontFamily: string;
    colorHex: string;
};

type SummaryResult = {
    objective: string;
    keyPoints: string[];
    vocabulary: string[];
};

// 1. COMPRESSED TEXT STREAM RECONSTRUCTION
const extractAndSortText = async (doc: any, maxPages = 15) => {
    let fullText = "";
    for(let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const items = (textContent.items as any[]).filter(item => item.transform);

        items.sort((a, b) => {
            const yDiff = b.transform[5] - a.transform[5];
            if (Math.abs(yDiff) > 5) return yDiff; 
            return a.transform[4] - b.transform[4];
        });

        let pageText = "";
        let lastY = -1;
        let lastX = -1;
        
        for (const item of items) {
           const currY = item.transform[5];
           const currX = item.transform[4];
           
           if (lastY !== -1 && Math.abs(currY - lastY) > 5) {
               pageText += "\n";
           } 
           else if (lastX !== -1 && (currX - lastX) > 5) {
               pageText += " ";
           }
           
           pageText += item.str;
           lastY = currY;
           lastX = currX + item.width;
        }
        fullText += pageText + "\n\n";
    }
    return fullText;
};

// 2. ADVANCED UNICODE GRAPHESIS BANGLA SUMMARIZER
const generateExtractiveSummary = (text: string): SummaryResult | null => {
  if (!text || text.trim().length === 0) return null;
  
  // High completeness Bangla and English stop-words
  const bnStopWords = new Set(["এবং", "কিন্তু", "অনুরূপ", "তাহা", "আছে", "হয়", "করে", "জন্য", "থেকে", "ও", "এই", "সেই", "পর", "না", "কি", "যে", "তার", "আমি", "তুমি", "সে", "তারা", "আমরা", "হতে", "সাথে", "যা", "তা"]);
  const enStopWords = new Set(["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once", "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with", "you", "your", "yours", "yourself", "yourselves"]);
  
  // Tokenize sentences by Western and Bangla punctuation
  const tokens = text.match(/[^.!?।]+[.!?।]*/g) || [text];
  const sentences = tokens.map(s => s.trim().replace(/[\r\n]+/g, ' ')).filter(s => s.length > 20);

  if (sentences.length === 0) return null;

  const wordFreq: Record<string, number> = {};
  
  // Unicode-aware regex to extract Bengali and Latin script cleanly without breaking conjugates
  const getWords = (s: string) => {
    try {
        return Array.from(s.matchAll(/[\p{Script=Bengali}\p{L}]+/gu)).map(m => m[0].toLowerCase());
    } catch(e) {
        // Fallback for older environments
        return Array.from(s.matchAll(/[a-z]+|[\u0980-\u09FF]+/gi)).map(m => m[0].toLowerCase());
    }
  };

  sentences.forEach((sentence) => {
    const words = getWords(sentence);
    words.forEach((word) => {
      if (!enStopWords.has(word) && !bnStopWords.has(word) && word.length > 2) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });
  });

  const sentenceScores = sentences.map((sentence, index) => {
    const words = getWords(sentence);
    let score = 0;
    words.forEach((word) => {
      if (wordFreq[word]) score += wordFreq[word];
    });
    score = words.length > 0 ? score / Math.sqrt(words.length) : 0; 
    return { index, sentence, score };
  });

  sentenceScores.sort((a, b) => b.score - a.score);
  
  const topSentences = sentenceScores.slice(0, 4);
  topSentences.sort((a, b) => a.index - b.index);

  const allKeyPoints = topSentences.map(s => s.sentence);
  const objective = sentenceScores[0]?.sentence || "Not enough data density.";
  const keyPoints = allKeyPoints.filter(s => s !== objective);

  const vocabArray = Object.entries(wordFreq).map(([word, count]) => ({word, count}));
  vocabArray.sort((a, b) => b.count - a.count);
  const vocabulary = vocabArray.slice(0, 12).map(v => v.word);

  return {
      objective,
      keyPoints: keyPoints.length > 0 ? keyPoints : allKeyPoints,
      vocabulary
  };
};

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<'editor'|'summary'>('editor');
  
  const [file, setFile] = useState<File | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  
  const [pdfDocHandle, setPdfDocHandle] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfDimensions, setPdfDimensions] = useState<{w: number, h: number} | null>(null);
  const [pageTextItems, setPageTextItems] = useState<PdfTextItem[]>([]);
  
  const [isRendering, setIsRendering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  
  const [summaryData, setSummaryData] = useState<SummaryResult | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  const [pastEdits, setPastEdits] = useState<EditEntry[][]>([]);
  const [edits, setEdits] = useState<EditEntry[]>([]);
  const [futureEdits, setFutureEdits] = useState<EditEntry[][]>([]);
  
  // Floating Contextual Toolbar State
  const [activeInput, setActiveInput] = useState<EditEntry | null>(null);

  // Zoom and Panning State
  const [zoomLevel, setZoomLevel] = useState(1.2);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      
      if (e.code === 'Space' && !isInput) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      
      if (!isInput && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            setPastEdits(past => {
                if (past.length === 0) return past;
                const newPast = [...past];
                const previousEdits = newPast.pop()!;
                setEdits(current => {
                    setFutureEdits(future => [current, ...future]);
                    return previousEdits;
                });
                return newPast;
            });
        }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            setFutureEdits(future => {
                if (future.length === 0) return future;
                const newFuture = [...future];
                const nextEdits = newFuture.shift()!;
                setEdits(current => {
                    setPastEdits(past => [...past, current]);
                    return nextEdits;
                });
                return newFuture;
            });
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsDragging(false);
      }
    };

    const handleBlur = () => {
      setIsSpacePressed(false);
      setIsDragging(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!pdfBuffer) return;
    setPdfDocHandle(null);
    setSummaryData(null);
    
    const initPdf = async () => {
        try {
           setIsSummarizing(true);
           const task = pdfjsLib.getDocument({ data: pdfBuffer.slice(0) });
           const doc = await task.promise;
           setPdfDocHandle(doc);
           setNumPages(doc.numPages);
           setCurrentPage(1);
           
           const fullText = await extractAndSortText(doc, 15);
           const result = generateExtractiveSummary(fullText);
           setSummaryData(result);
        } catch (e) {
           console.error(e);
        } finally {
           setIsSummarizing(false);
        }
    };
    initPdf();
  }, [pdfBuffer]);

  useEffect(() => {
    if (!pdfDocHandle || !canvasRef.current) return;
    const renderPage = async () => {
        setIsRendering(true);
        setActiveInput(null); // Close floating toolbar on page change
        try {
            const page = await pdfDocHandle.getPage(currentPage);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = canvasRef.current!;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            const originalViewport = page.getViewport({ scale: 1.0 });
            setPdfDimensions({ w: originalViewport.width, h: originalViewport.height });

            const ctx = canvas.getContext('2d');
            if(ctx) {
                await page.render({ canvasContext: ctx, viewport }).promise;
            }

            const textContent = await page.getTextContent({ includeMarkedContent: true });
            const parsedItems = textContent.items.filter((item: any) => item.transform && item.str).map((item: any) => {
                const style = textContent.styles[item.fontName];
                let colorHex = '#18181b';
                if (item.color) {
                   if (Array.isArray(item.color)) {
                      colorHex = '#' + item.color.map((c:number) => {
                          const hex = c.toString(16);
                          return hex.length === 1 ? '0' + hex : hex;
                      }).join('');
                   }
                }

                const fontHeight = Math.abs(item.transform[3]);
                
                return {
                    str: item.str,
                    pdfX: item.transform[4],
                    pdfY: item.transform[5],
                    pdfW: item.width,
                    pdfH: item.height || fontHeight,
                    fontSize: Math.round(fontHeight),
                    fontFamily: style?.fontFamily || 'Helvetica',
                    colorHex: colorHex,
                };
            });
            setPageTextItems(parsedItems);
        } catch (e) {
            console.error("Render failed", e);
        } finally {
            setIsRendering(false);
        }
    };
    renderPage();
  }, [pdfDocHandle, currentPage]);

  const handleFileUpload = async (uploadedFile: File) => {
    if (uploadedFile.type !== 'application/pdf') {
      alert('Only PDF files are supported.');
      return;
    }
    const arrayBuffer = await uploadedFile.arrayBuffer();
    setFile(uploadedFile);
    setPdfBuffer(arrayBuffer);
    setEdits([]);
    setPastEdits([]);
    setFutureEdits([]);
    setActiveTab('editor');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileUpload(f);
  };

  const handleViewportMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSpacePressed) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      if (viewportRef.current) {
        setScrollStart({
          left: viewportRef.current.scrollLeft,
          top: viewportRef.current.scrollTop
        });
      }
    }
  };

  const handleViewportMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging && isSpacePressed && viewportRef.current) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      viewportRef.current.scrollLeft = scrollStart.left - dx;
      viewportRef.current.scrollTop = scrollStart.top - dy;
    }
  };

  const handleViewportMouseUpOrLeave = () => {
    if (isDragging) {
      setIsDragging(false);
    }
  };

  const handleCanvasInteraction = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if(!pdfDimensions || !canvasRef.current || isRendering) return;
    
    // Prevent default to avoid mobile scroll bouncing when tapping
    if('touches' in e) e.preventDefault();

    let clientX, clientY;
    if ('touches' in e && ('touches' in (e.nativeEvent || e))) {
      const touchEvent = (e as unknown as React.TouchEvent);
      clientX = touchEvent.touches[0].clientX;
      clientY = touchEvent.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    
    const scaleX = pdfDimensions.w / rect.width;
    const scaleY = pdfDimensions.h / rect.height;
    
    const pdfX = x * scaleX;
    const pdfY = pdfDimensions.h - (y * scaleY);
    
    // Check intersection with existing text items
    const paddingX = 8;
    const paddingY = 6;
    const tappedItem = pageTextItems.find(item => {
        return (
            pdfX >= item.pdfX - paddingX &&
            pdfX <= item.pdfX + item.pdfW + paddingX &&
            pdfY >= item.pdfY - paddingY &&
            pdfY <= item.pdfY + item.pdfH + paddingY
        );
    });

    if (tappedItem && tappedItem.str.trim()) {
        setActiveInput({
            id: Date.now().toString(),
            page: currentPage,
            pdfX: tappedItem.pdfX,
            pdfY: tappedItem.pdfY,
            text: tappedItem.str,
            color: tappedItem.colorHex || '#18181b', 
            size: Math.max(10, Math.round(tappedItem.fontSize)),
            fontFamily: tappedItem.fontFamily || 'Helvetica',
            isReplacement: true,
            maskPdfX: tappedItem.pdfX - 2,
            maskPdfY: tappedItem.pdfY - tappedItem.pdfH * 0.25, 
            maskPdfW: tappedItem.pdfW + 4,
            maskPdfH: tappedItem.pdfH * 1.5,
        });
    } else {
        setActiveInput({
          id: Date.now().toString(),
          page: currentPage,
          pdfX,
          pdfY,
          text: '',
          color: '#3b82f6',
          size: 14,
          fontFamily: 'Helvetica',
          isReplacement: false,
          maskPdfX: 0, maskPdfY: 0, maskPdfW: 0, maskPdfH: 0
        });
    }
  };

  const commitActiveInput = () => {
    if (activeInput && activeInput.text.trim()) {
       setPastEdits(past => [...past, edits]);
       setFutureEdits([]);
       setEdits([...edits, activeInput]);
    }
    setActiveInput(null);
  };

  const handleSavePdf = async () => {
    if (!pdfBuffer || !file) return;
    setIsExporting(true);
    try {
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        pdfDoc.registerFontkit(fontkit);
        
        let customFont;
        if(edits.length > 0) {
            try {
                const rs = await fetch('https://cdn.jsdelivr.net/gh/shironamhin/bangla-fonts/kalpurush/kalpurush.ttf');
                if(rs.ok) {
                    const fontBuffer = await rs.arrayBuffer();
                    customFont = await pdfDoc.embedFont(fontBuffer);
                }
            } catch (err) {
                console.warn('Fallback due to no network.', err);
            }
            if(!customFont) {
                customFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
            }
        }

        const pages = pdfDoc.getPages();
        for (const edit of edits) {
            const pageIndex = edit.page - 1;
            if (pageIndex >= 0 && pageIndex < pages.length) {
                const page = pages[pageIndex];
                
                // ==========================================
                // 1. ABSOLUTE TEXT WIPEOUT LOGIC
                // Execute a clean whiteout mask over the exact text coordinates.
                // This permanently hides the previous text by rendering a solid rectangle.
                // ==========================================
                if (edit.isReplacement) {
                    page.drawRectangle({
                        x: edit.maskPdfX,
                        y: edit.maskPdfY,
                        width: edit.maskPdfW,
                        height: edit.maskPdfH,
                        color: rgb(1, 1, 1),
                    });
                }

                // ==========================================
                // 2. TEXT REPLACEMENT LOGIC
                // Render the new string (supporting English and Bangla Unicode)
                // directly on top of the newly cleaned coordinate space.
                // ==========================================
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(edit.color);
                const r = result ? parseInt(result[1], 16) / 255 : 0;
                const g = result ? parseInt(result[2], 16) / 255 : 0;
                const b = result ? parseInt(result[3], 16) / 255 : 0;
                
                const lines = edit.text.split('\n');
                let curY = edit.pdfY;
                for(let line of lines) {
                   page.drawText(line, {
                       x: edit.pdfX,
                       y: curY,
                       size: edit.size,
                       color: rgb(r, g, b),
                       font: customFont
                   });
                   curY -= (edit.size * 1.2);
                }
            }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `amended_${file.name}`;
        link.click();
    } catch (err) {
        console.error("Save error:", err);
        alert("Failed to export amended PDF.");
    } finally {
        setIsExporting(false);
    }
  };

  return (
    <>
      {showSplash && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white transition-opacity duration-500">
          <div className="w-16 h-16 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 shadow-xl border border-white/10 mb-6 drop-shadow-2xl">
            <LayoutTemplate className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Zen Pdf editor</h1>
          <p className="text-zinc-400 font-mono text-sm tracking-widest uppercase">Created by Fardin</p>
          <div className="absolute bottom-12 text-zinc-600">
             <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        </div>
      )}
    <div className="bg-[#fcfcfc] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 w-full min-h-[100dvh] flex flex-col font-sans selection:bg-blue-500/20 overflow-hidden transition-colors">
      
      {/* Enterprise Header */}
      <header className="h-16 lg:h-16 border-b border-zinc-200 dark:border-zinc-900 flex items-center justify-between px-4 lg:px-6 bg-white/80 dark:bg-zinc-950/80 shrink-0 z-20 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0 border border-white/10">
            <LayoutTemplate className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold tracking-[0.2em] text-blue-600 dark:text-blue-400 uppercase">Core Systems</span>
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 tracking-tight truncate">Zen Pdf editor</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2 lg:gap-4 shrink-0">
           {file && (
             <button
                onClick={handleSavePdf}
                disabled={isExporting}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 text-[11px] lg:text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-sm min-w-[120px] min-h-[44px]"
             >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4" />}
                <span className="hidden sm:inline">Export Amended</span>
             </button>
           )}
        </div>
      </header>

      {/* Main Split-Pane Architecture Layout */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
          
          {/* LEFT TOOLBAR */}
          <aside className={cn(
            "hidden lg:flex w-16 flex-col items-center py-4 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0 z-10 gap-3",
            !file && "opacity-50 pointer-events-none"
          )}>
               <button title="Undo (Ctrl+Z)" onClick={() => {
                        setPastEdits(past => {
                            if (past.length === 0) return past;
                            const newPast = [...past];
                            const previousEdits = newPast.pop()!;
                            setEdits(current => {
                                setFutureEdits(future => [current, ...future]);
                                return previousEdits;
                            });
                            return newPast;
                        });
                }} className="p-3 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500 disabled:opacity-30 disabled:hover:bg-transparent" disabled={pastEdits.length === 0}>
                    <Undo2 className="w-5 h-5" />
                </button>
                <button title="Redo (Ctrl+Y)" onClick={() => {
                        setFutureEdits(future => {
                            if (future.length === 0) return future;
                            const newFuture = [...future];
                            const nextEdits = newFuture.shift()!;
                            setEdits(current => {
                                setPastEdits(past => [...past, current]);
                                return nextEdits;
                            });
                            return newFuture;
                        });
                }} className="p-3 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500 disabled:opacity-30 disabled:hover:bg-transparent" disabled={futureEdits.length === 0}>
                    <Redo2 className="w-5 h-5" />
                </button>

                <div className="w-8 h-px bg-zinc-200 dark:bg-zinc-800 my-2"></div>
                <button title="Select Tool" className={cn("p-3 rounded-xl", !isSpacePressed ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" : "hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500")}>
                    <MousePointer2 className="w-5 h-5" />
                </button>
                <button title="Pan Tool (Hold Space)" className={cn("p-3 rounded-xl", isSpacePressed ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" : "hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500")}>
                    <Hand className="w-5 h-5" />
                </button>
          </aside>

          {/* MAIN SPACE: Editor Workspace */}
          <div className={cn(
             "h-full flex-col bg-zinc-100 dark:bg-zinc-900 flex-1 shrink lg:flex relative border-r border-zinc-200 dark:border-zinc-800/50 block min-w-0",
             activeTab === 'editor' ? "flex" : "hidden"
          )}>
             {!file ? (
                 <div className="flex-1 flex flex-col items-center justify-center p-6 bg-transparent">
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={handleDrop}
                      className="w-full max-w-xl aspect-square sm:aspect-video lg:h-[420px] bg-white dark:bg-zinc-950 border border-dashed border-zinc-300 dark:border-zinc-800 rounded-3xl flex flex-col items-center justify-center gap-5 p-10 cursor-pointer hover:border-blue-500/50 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group shadow-sm"
                    >
                       <div className="p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-900 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors border border-zinc-200 dark:border-zinc-800 shadow-sm">
                         <Upload className="w-8 h-8 text-zinc-400 dark:text-zinc-500 group-hover:text-blue-500" />
                       </div>
                       <div className="flex flex-col items-center text-center gap-2 mt-2">
                         <span className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">Initialize Workspace</span>
                         <span className="text-sm text-zinc-500 max-w-[320px] leading-relaxed">Drop a PDF securely. Client-side extraction prevents data egress. Includes native Unicode replacement blocks.</span>
                       </div>
                       <input 
                         type="file" 
                         accept="application/pdf" 
                         ref={fileInputRef} 
                         className="hidden" 
                         onChange={(e) => { const f = e.target.files?.[0]; if(f) handleFileUpload(f); }} 
                       />
                    </div>
                 </div>
             ) : (
                 <div className="flex-1 flex flex-col overflow-hidden relative">
                    {/* Viewport Toolbar */}
                    <div className="h-14 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between px-4 sm:px-6 shrink-0 relative z-10 min-h-[56px]">
                       <span className="text-xs text-zinc-500 font-mono truncate max-w-[140px] sm:max-w-xs hidden md:block">{file.name}</span>
                       
                       <div className="flex items-center gap-4 ml-auto sm:ml-0">
                           {/* Zoom Controls */}
                           <div className="flex items-center gap-2 pr-4 h-10 min-h-[44px] hidden sm:flex border-r border-zinc-200 dark:border-zinc-800">
                              <button onClick={() => setZoomLevel(z => Math.max(0.2, parseFloat((z - 0.1).toFixed(1))))} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-500 transition-colors"><Minus className="w-4 h-4"/></button>
                              <input 
                                 type="range" 
                                 min="0.2" max="3.0" step="0.1" 
                                 value={zoomLevel} 
                                 onChange={e => setZoomLevel(parseFloat(e.target.value))} 
                                 className="w-20 lg:w-32 accent-blue-500 cursor-pointer h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                              />
                              <button onClick={() => setZoomLevel(z => Math.min(5.0, parseFloat((z + 0.1).toFixed(1))))} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-500 transition-colors"><Plus className="w-4 h-4"/></button>
                              <span className="text-[10px] font-mono tracking-widest text-zinc-400 w-10 text-right inline-block">{Math.round(zoomLevel * 100)}%</span>
                           </div>

                           <div className="flex items-center gap-2 sm:gap-3 bg-zinc-100 dark:bg-zinc-900 rounded-lg p-1 border border-zinc-200 dark:border-zinc-800 shadow-inner">
                              <button disabled={currentPage <= 1 || isRendering} onClick={() => setCurrentPage(c=>c-1)} className="p-1 min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] hover:bg-white dark:hover:bg-zinc-800 rounded-md flex items-center justify-center disabled:opacity-30 shadow-sm transition-all"><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 dark:text-zinc-300"/></button>
                              <span className="text-[10px] sm:text-[11px] font-mono tracking-widest text-zinc-500 dark:text-zinc-400 font-bold px-2 sm:px-3 whitespace-nowrap">PAGE {currentPage} / {numPages}</span>
                              <button disabled={currentPage >= numPages || isRendering} onClick={() => setCurrentPage(c=>c+1)} className="p-1 min-w-[36px] min-h-[36px] sm:min-w-[44px] sm:min-h-[44px] hover:bg-white dark:hover:bg-zinc-800 rounded-md flex items-center justify-center disabled:opacity-30 shadow-sm transition-all"><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-600 dark:text-zinc-300"/></button>
                           </div>
                        </div>
                     </div>
                     
                     {/* Interactive Canvas Plane */}
                     <div 
                       ref={viewportRef} 
                       className={cn(
                           "flex-1 overflow-auto p-4 lg:p-12 flex bg-zinc-100 dark:bg-zinc-900 justify-center",
                           isSpacePressed && !isDragging && "cursor-grab select-none",
                           isDragging && "cursor-grabbing select-none"
                       )}
                       id="pdf-viewport"
                       onMouseDown={handleViewportMouseDown}
                       onMouseMove={handleViewportMouseMove}
                       onMouseUp={handleViewportMouseUpOrLeave}
                       onMouseLeave={handleViewportMouseUpOrLeave}
                    >
                       <div 
                         className={cn(
                           "relative inline-block shadow-2xl bg-white origin-top ring-1 ring-zinc-200 dark:ring-zinc-800 shrink-0 transition-[width] duration-150 ease-out",
                           !isSpacePressed && "cursor-crosshair"
                         )}
                         style={{ width: pdfDimensions ? `${pdfDimensions.w * zoomLevel}px` : '100%' }}
                         onClick={(e) => {
                             if(!activeInput && !isDragging && !isSpacePressed) handleCanvasInteraction(e);
                         }}
                       >
                           {isRendering && (
                              <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-zinc-900/50 z-10 backdrop-blur-[2px]">
                                 <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                              </div>
                           )}
                           
                           <canvas ref={canvasRef} className="w-full h-auto block" />
                           
                           {/* Applied Edits Overlay */}
                           {pdfDimensions && edits.filter(e => e.page === currentPage).map(edit => (
                              <div key={edit.id}>
                                  {edit.isReplacement && (
                                     <div 
                                        style={{
                                            position: 'absolute',
                                            left: `${(edit.maskPdfX / pdfDimensions.w) * 100}%`,
                                            top: `${(1 - ((edit.maskPdfY + edit.maskPdfH) / pdfDimensions.h)) * 100}%`,
                                            width: `${(edit.maskPdfW / pdfDimensions.w) * 100}%`,
                                            height: `${(edit.maskPdfH / pdfDimensions.h) * 100}%`,
                                        }}
                                        className="bg-white z-0"
                                     />
                                  )}
                                  <div 
                                     style={{ 
                                        position: 'absolute', 
                                        left: `${(edit.pdfX / pdfDimensions.w) * 100}%`, 
                                        top: `${(1 - (edit.pdfY / pdfDimensions.h)) * 100}%`,
                                        color: edit.color,
                                        fontSize: 'clamp(10px, 100%, 24px)', // Let CSS map reasonably to PDF scale
                                        transform: 'translate(0%, -100%)',
                                        lineHeight: 1.2,
                                        whiteSpace: 'pre'
                                     }}
                                     className="group z-10 border border-transparent hover:border-dashed hover:border-red-500/80 hover:bg-red-50/50 dark:hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                                     onClick={(e) => {
                                        e.stopPropagation();
                                        setPastEdits(past => [...past, edits]);
                                        setFutureEdits([]);
                                        setEdits(edits.filter(x => x.id !== edit.id));
                                     }}
                                  >
                                     <span className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full hidden group-hover:flex z-20 shadow-lg w-8 h-8 items-center justify-center cursor-pointer">
                                        <X className="w-4 h-4" />
                                     </span>
                                     <span style={{ fontSize: `${edit.size * zoomLevel}px` }}>
                                         {edit.text}
                                     </span>
                                  </div>
                              </div>
                           ))}

                           {/* FLOATING CONTEXTUAL TOOLBAR */}
                           {activeInput && pdfDimensions && (
                               <div 
                                  style={{
                                      position: 'absolute',
                                      left: `${(activeInput.pdfX / pdfDimensions.w) * 100}%`,
                                      top: `${(1 - ((activeInput.pdfY + (activeInput.maskPdfH || 20)) / pdfDimensions.h)) * 100}%`,
                                      transform: 'translate(-50%, -100%)',
                                      marginTop: '-16px'
                                  }}
                                  className="z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl shadow-black/20 rounded-2xl p-4 flex flex-col gap-4 min-w-[340px] max-w-[90vw] animate-in slide-in-from-bottom-2 fade-in duration-200"
                                  onClick={e => e.stopPropagation()}
                               >
                                   <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white dark:bg-zinc-900 border-b border-r border-zinc-200 dark:border-zinc-800 transform rotate-45"></div>
                                   
                                   <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800/80">
                                      <div className="flex items-center gap-2 text-zinc-800 dark:text-锌-100">
                                         {activeInput.isReplacement ? <Eraser className="w-4 h-4 text-orange-500" /> : <Type className="w-4 h-4 text-blue-500" />}
                                         <span className="text-xs font-bold uppercase tracking-widest">{activeInput.isReplacement ? "Override Stream" : "Inject Segment"}</span>
                                      </div>
                                      <button onClick={() => setActiveInput(null)} className="w-11 h-11 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full flex items-center justify-center transition-colors text-zinc-500 shrink-0"><X className="w-4 h-4"/></button>
                                   </div>

                                   <textarea
                                      value={activeInput.text}
                                      onChange={e => setActiveInput({...activeInput, text: e.target.value})}
                                      autoFocus
                                      className="w-full h-[80px] bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-[13px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none selection:bg-blue-200 dark:selection:bg-blue-900"
                                      placeholder="Type new Unicode payload..."
                                   />
                                   
                                   <div className="flex items-center justify-between gap-3 p-1">
                                      <div className="flex flex-col gap-1 w-1/2">
                                          <label className="text-[9px] font-mono tracking-widest uppercase text-zinc-400 ml-1">Family</label>
                                          <select 
                                              value={activeInput.fontFamily} 
                                              onChange={(e) => setActiveInput({...activeInput, fontFamily: e.target.value})}
                                              className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 h-10 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none focus:border-blue-500 appearance-none min-h-[44px]"
                                          >
                                              <option value="Helvetica">Helvetica</option>
                                              <option value="Times-Roman">Times-Roman</option>
                                              <option value="Courier">Courier</option>
                                              <option value={activeInput.fontFamily}>{activeInput.fontFamily} (Detected)</option>
                                          </select>
                                      </div>

                                      <div className="flex flex-col gap-1 w-1/4">
                                          <label className="text-[9px] font-mono tracking-widest uppercase text-zinc-400 ml-1 text-center">Pt Size</label>
                                          <div className="flex items-center bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg h-10 min-h-[44px]">
                                             <button onClick={() => setActiveInput(prev => ({...prev!, size: Math.max(6, prev!.size - 1)}))} className="flex-1 flex justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"><Minus className="w-3 h-3"/></button>
                                             <input type="number" min="6" max="144" value={activeInput.size} onChange={e => setActiveInput({...activeInput, size: parseInt(e.target.value)||12})} className="w-8 bg-transparent text-center text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none appearance-none" />
                                             <button onClick={() => setActiveInput(prev => ({...prev!, size: Math.min(144, prev!.size + 1)}))} className="flex-1 flex justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"><Plus className="w-3 h-3"/></button>
                                          </div>
                                      </div>

                                      <div className="flex flex-col gap-1 w-1/4">
                                         <label className="text-[9px] font-mono tracking-widest uppercase text-zinc-400 ml-1 text-center">Tint</label>
                                         <div className="relative w-full h-10 min-h-[44px] rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                                             <input type="color" value={activeInput.color} onChange={e => setActiveInput({...activeInput, color: e.target.value})} className="absolute -inset-2 w-[200%] h-[200%] cursor-pointer" />
                                         </div>
                                      </div>
                                   </div>
                                   
                                   <div className="flex gap-2 mt-2">
                                       <button onClick={() => setActiveInput(null)} className="flex-1 py-2.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-[11px] font-bold tracking-widest uppercase rounded-lg transition-colors min-h-[44px]">Cancel</button>
                                       <button onClick={commitActiveInput} disabled={!activeInput.text.trim()} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold tracking-widest uppercase rounded-lg transition-colors disabled:opacity-50 min-h-[44px]">Apply Edit</button>
                                   </div>
                               </div>
                           )}
                       </div>
                    </div>
                 </div>
             )}
          </div>

          {/* RIGHT PANEL 35%: Executive Summary Dashboard */}
          <div className={cn(
             "h-full flex-col bg-white dark:bg-zinc-950 flex-1 lg:flex shrink-0 border-l border-zinc-200 dark:border-zinc-900 shadow-xl z-20 relative",
             activeTab === 'summary' ? "flex" : "hidden lg:flex"
          )}>
             <div className="p-5 border-b border-zinc-100 dark:border-zinc-900 flex items-center justify-between shrink-0 h-16 sm:h-[72px] bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="flex items-center gap-3">
                   <div className="p-2.5 bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl shadow-sm">
                       <Activity className="w-5 h-5" />
                   </div>
                   <div className="flex flex-col">
                       <span className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Executive Diagnostics</span>
                       <span className="text-[10px] text-zinc-500 font-mono mt-0.5 tracking-wider uppercase">Offline NLP Array</span>
                   </div>
                </div>
             </div>
             
             <div className="flex-1 overflow-y-auto p-5 lg:p-8 relative pb-28 md:pb-8">
                 {!file && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-600 text-center px-6 min-h-[300px]">
                      <BarChart2 className="w-16 h-16 mb-6 stroke-1 text-zinc-300 dark:text-zinc-800" />
                      <p className="text-base font-semibold text-zinc-600 dark:text-zinc-400">Array Standing By</p>
                      <p className="text-sm mt-3 max-w-[280px] leading-relaxed">Initialize a document to generate structured structural matrices and deep vocabulary density analysis.</p>
                    </div>
                 )}

                 {isSummarizing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md z-10 p-6 text-center">
                       <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-6" />
                       <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-2 tracking-tight">Extracting Semantics</h3>
                       <p className="text-[10px] uppercase font-mono tracking-widest text-zinc-500">Cross-comparing unicode density</p>
                    </div>
                 )}

                 {file && !isSummarizing && summaryData && (
                    <div className="space-y-6 flex flex-col mx-auto max-w-lg">
                      
                      {/* CARD 1: Core Objective */}
                      <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-2xl p-6 shadow-sm">
                          <h3 className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                             <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse"></div>
                             Principal Objective
                          </h3>
                          <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed font-serif">
                             {summaryData.objective}
                          </p>
                      </div>
                      
                      {/* CARD 2: Structural Insights */}
                      <div className="bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800/60 rounded-2xl p-6 shadow-sm">
                          <h3 className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                             <AlignLeft className="w-3.5 h-3.5" /> Key Structural Insights
                          </h3>
                          <div className="space-y-4">
                            {summaryData.keyPoints.map((sentence, i) => (
                              <div key={i} className="relative pl-5 group">
                                 <span className="absolute left-0 top-2 w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 group-hover:scale-150 transition-transform"></span>
                                 <p className="text-[13px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-serif">
                                   {sentence}
                                 </p>
                              </div>
                            ))}
                          </div>
                      </div>

                      {/* CARD 3: Contextual Vocabulary Analytics */}
                      <div className="bg-white dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800/60 rounded-2xl p-6 shadow-sm">
                         <h3 className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                             <Zap className="w-3.5 h-3.5 text-orange-500" /> Contextual Vocabulary Array
                         </h3>
                         <div className="flex flex-wrap gap-2">
                            {summaryData.vocabulary.map((vocabItem, i) => (
                               <span key={i} className="text-[11px] px-3 py-1.5 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-700 dark:text-zinc-300 font-mono hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-default whitespace-nowrap inline-flex shadow-sm">
                                   {vocabItem}
                               </span>
                            ))}
                         </div>
                      </div>

                    </div>
                 )}
             </div>
          </div>
          
      </main>

      {/* MOBILE: BOTTOM NAVIGATION TAB BAR */}
      <div className="flex lg:hidden bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-900 shrink-0 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] z-40 fixed bottom-0 left-0 right-0 h-[72px] pb-safe">
          <button 
             onClick={() => setActiveTab('editor')} 
             className={cn(
                "flex-1 py-2 flex flex-col items-center justify-center gap-1.5 transition-colors min-h-[64px]", 
                activeTab === 'editor' ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 dark:text-zinc-500"
             )}
          >
             <PenTool className="w-5 h-5" />
             <span className="text-[10px] font-bold uppercase tracking-wider">Workspace</span>
          </button>
          
          <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-800 my-auto"></div>
          
          <button 
             onClick={() => setActiveTab('summary')} 
             className={cn(
                "flex-1 py-2 flex flex-col items-center justify-center gap-1.5 transition-colors min-h-[64px]", 
                activeTab === 'summary' ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"
             )}
          >
             <Activity className="w-5 h-5" />
             <span className="text-[10px] font-bold uppercase tracking-wider">Diagnostics</span>
          </button>
      </div>

    </div>
    </>
  );
}

