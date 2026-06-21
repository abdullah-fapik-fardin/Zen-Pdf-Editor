import React, { useState, useEffect, useRef } from 'react';
import { Upload, X, Save, FileText, Loader2, LayoutTemplate, PenTool, Zap, ChevronLeft, ChevronRight, Type, Eraser, Settings2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PDFDocument, rgb } from 'pdf-lib';
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
  
  // Masking properties for text replacement
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
const extractAndSortText = async (doc: any, maxPages = 10) => {
    let fullText = "";
    for(let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items as any[];

        // Proximity Sorting: Group by horizontal lines (Y-axis proximity), then order by X-axis
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
           
           // If Y difference implies a new line
           if (lastY !== -1 && Math.abs(currY - lastY) > 5) {
               pageText += "\n";
           } 
           // If X difference implies a space
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
  const bnStopWords = new Set(["এবং", "কিন্তু", "অনুরূপ", "তাহা", "আছে", "হয়", "করে", "জন্য", "থেকে", "ও", "এই", "সেই", "পর", "না", "কি", "যে", "তার", "আমি", "তুমি", "সে", "তারা", "আমরা", "হতে", "সাথে", "হয়"]);
  const enStopWords = new Set(["a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "can", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once", "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with", "you", "your", "yours", "yourself", "yourselves"]);
  
  // Tokenize sentences by English punctuation and Bangla Dari "।"
  const tokens = text.match(/[^.!?।]+[.!?।]*/g) || [text];
  const sentences = tokens.map(s => s.trim().replace(/[\r\n]+/g, ' ')).filter(s => s.length > 20);

  if (sentences.length === 0) return null;

  const wordFreq: Record<string, number> = {};
  
  // Unicode-aware regex to extract valid word structures globally across English and Bengali without breaking characters
  const getWords = (s: string) => {
    return Array.from(s.matchAll(/[\p{Script=Bengali}\p{L}]+/gu)).map(m => m[0].toLowerCase());
  };

  sentences.forEach((sentence) => {
    const words = getWords(sentence);
    words.forEach((word) => {
      // Ignore short punctuation noise and stop words
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
    // Normalize string weight vs sentence length
    score = words.length > 0 ? score / Math.sqrt(words.length) : 0; 
    return { index, sentence, score };
  });

  sentenceScores.sort((a, b) => b.score - a.score);
  
  // Top sentences extraction
  const topSentences = sentenceScores.slice(0, 5);
  topSentences.sort((a, b) => a.index - b.index); // Re-order chronologically

  const allKeyPoints = topSentences.map(s => s.sentence);
  
  // Determine Core Objective (Highest Density Sentence)
  const objective = sentenceScores[0]?.sentence || "Insufficient structural density to determine objective.";
  
  // Key points are all top sentences excluding the core objective exact match
  const keyPoints = allKeyPoints.filter(s => s !== objective);

  // Determine Contextual Vocabulary Context
  const vocabArray = Object.entries(wordFreq).map(([word, count]) => ({word, count}));
  vocabArray.sort((a, b) => b.count - a.count);
  const vocabulary = vocabArray.slice(0, 15).map(v => v.word);

  return {
      objective,
      keyPoints: keyPoints.length > 0 ? keyPoints : allKeyPoints,
      vocabulary
  };
};

export default function App() {
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
  
  const [summaryData, setSummaryData] = useState<SummaryResult | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  const [edits, setEdits] = useState<EditEntry[]>([]);
  const [activeInput, setActiveInput] = useState<EditEntry | null>(null);
  const [showConfigOptions, setShowConfigOptions] = useState(false);

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
           
           // Fetch and compile summary
           const fullText = await extractAndSortText(doc, 10);
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
        try {
            const page = await pdfDocHandle.getPage(currentPage);
            const viewport = page.getViewport({ scale: 2.0 }); // High-res retina rendering
            const canvas = canvasRef.current!;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            const originalViewport = page.getViewport({ scale: 1.0 });
            setPdfDimensions({ w: originalViewport.width, h: originalViewport.height });

            const ctx = canvas.getContext('2d');
            if(ctx) {
                await page.render({ canvasContext: ctx, viewport }).promise;
            }

            // Extract bounding boxes and internal font graphics state for text masking
            const textContent = await page.getTextContent({ includeMarkedContent: true });
            
            const parsedItems = textContent.items.map((item: any) => {
                const style = textContent.styles[item.fontName];
                
                // Color retrieval can be sparse; pdfjs color space depends heavily on internal specs
                let colorHex = '#1e293b'; // Default fallback color (zinc-800)
                if (item.color) {
                   if (Array.isArray(item.color)) {
                      // Parse array formatting
                      colorHex = '#' + item.color.map((c:number) => {
                          const hex = c.toString(16);
                          return hex.length === 1 ? '0' + hex : hex;
                      }).join('');
                   }
                }

                // Transform matrix: [0]=scaleX, [1]=skewY, [2]=skewX, [3]=scaleY, [4]=translateX, [5]=translateY
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
    setActiveTab('editor');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileUpload(f);
  };

  const handleCanvasInteraction = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if(!pdfDimensions || !canvasRef.current || isRendering) return;
    
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
    
    // 3. WHITEOUT HIT-TEST COMPUTATION WITH SPECIFICATION DETECTION
    const paddingX = 10;
    const paddingY = 8;
    const tappedItem = pageTextItems.find(item => {
        return (
            pdfX >= item.pdfX - paddingX &&
            pdfX <= item.pdfX + item.pdfW + paddingX &&
            pdfY >= item.pdfY - paddingY &&
            pdfY <= item.pdfY + item.pdfH + paddingY
        );
    });

    if (tappedItem && tappedItem.str.trim()) {
        // Replacement Mode: Auto-populate specifications from internal PDF graphics state
        setActiveInput({
            id: Date.now().toString(),
            page: currentPage,
            pdfX: tappedItem.pdfX,
            pdfY: tappedItem.pdfY,
            text: tappedItem.str,
            color: tappedItem.colorHex || '#1e293b', 
            size: Math.max(10, Math.round(tappedItem.fontSize)),
            fontFamily: tappedItem.fontFamily || 'Helvetica',
            isReplacement: true,
            // Slightly oversize the mask to ensure full block erasure coverage
            maskPdfX: tappedItem.pdfX - 2,
            maskPdfY: tappedItem.pdfY - tappedItem.pdfH * 0.25, 
            maskPdfW: tappedItem.pdfW + 4,
            maskPdfH: tappedItem.pdfH * 1.5,
        });
    } else {
        // Standard Text Injection Mode
        setActiveInput({
          id: Date.now().toString(),
          page: currentPage,
          pdfX,
          pdfY,
          text: '',
          color: '#4f46e5',
          size: 14,
          fontFamily: 'Helvetica',
          isReplacement: false,
          maskPdfX: 0, maskPdfY: 0, maskPdfW: 0, maskPdfH: 0
        });
    }
    setShowConfigOptions(false);
  };

  const commitActiveInput = () => {
    if (activeInput && activeInput.text.trim()) {
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
                // Fetch high-quality open-source Bangla/English UTF font payload
                const rs = await fetch('https://cdn.jsdelivr.net/gh/shironamhin/bangla-fonts/kalpurush/kalpurush.ttf');
                if(!rs.ok) throw new Error("Network error fetching Kalpurush");
                const fontBuffer = await rs.arrayBuffer();
                customFont = await pdfDoc.embedFont(fontBuffer);
            } catch (err) {
                console.warn('Network offline or fetch failed. Custom Unicode may fallback.', err);
                const { StandardFonts } = require('pdf-lib');
                customFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
            }
        }

        const pages = pdfDoc.getPages();
        for (const edit of edits) {
            const pageIndex = edit.page - 1;
            if (pageIndex >= 0 && pageIndex < pages.length) {
                const page = pages[pageIndex];
                
                // MASK EXISTING CONTENT FIRST (if replacement active)
                if (edit.isReplacement) {
                    page.drawRectangle({
                        x: edit.maskPdfX,
                        y: edit.maskPdfY,
                        width: edit.maskPdfW,
                        height: edit.maskPdfH,
                        color: rgb(1, 1, 1), // Standard white wipeout block
                    });
                }

                // INJECT NEW CONTENT
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
                       font: customFont // Using explicitly embedded Kalpurush/Helvetica graph font
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
        alert("Failed to export complete PDF payload.");
    } finally {
        setIsExporting(false);
    }
  };

  return (
    <div className="bg-zinc-950 text-zinc-300 w-full min-h-[100dvh] flex flex-col font-sans selection:bg-zinc-800 overflow-hidden">
      
      {/* Universal Desktop/Mobile Header */}
      <header className="h-14 lg:h-16 border-b border-zinc-900 flex items-center justify-between px-4 lg:px-6 bg-zinc-950/80 shrink-0 z-10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 lg:w-10 lg:h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(79,70,229,0.4)] shrink-0">
            <Zap className="w-4 h-4 lg:w-5 lg:h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] lg:text-[10px] font-bold tracking-widest text-indigo-400 uppercase">Graphesis Core</span>
            <span className="text-xs lg:text-sm font-semibold text-white tracking-wide truncate">Localized Graphesis</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2 lg:gap-4 shrink-0">
           {file && (
             <button
                onClick={handleSavePdf}
                disabled={isExporting}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 disabled:text-indigo-700 text-white text-[10px] lg:text-xs font-bold uppercase tracking-widest rounded-lg transition-colors min-w-[120px] min-h-[44px]"
             >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4" />}
                <span className="hidden sm:inline">Export Amended</span>
             </button>
           )}
        </div>
      </header>

      {/* Main Responsive Application Layout */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
          
          {/* SECTION A: DIRECT PDF EDITOR WORKSPACE */}
          <div className={cn(
             "h-full flex-col bg-zinc-900 w-full lg:flex lg:flex-1 relative",
             activeTab === 'editor' ? "flex" : "hidden"
          )}>
             {!file ? (
                 <div className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-900/50">
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={handleDrop}
                      className="w-full max-w-xl aspect-square sm:aspect-video lg:h-[400px] bg-zinc-950/50 border-2 border-dashed border-zinc-700 rounded-2xl flex flex-col items-center justify-center gap-4 p-8 cursor-pointer hover:bg-zinc-900 hover:border-indigo-500/50 transition-all group"
                    >
                       <div className="p-5 rounded-xl bg-zinc-800 group-hover:bg-indigo-600/20 transition-colors border border-zinc-700 group-hover:border-indigo-500/50 shadow-inner">
                         <Upload className="w-8 h-8 text-zinc-400 group-hover:text-indigo-400" />
                       </div>
                       <div className="flex flex-col items-center text-center gap-2 mt-4">
                         <span className="text-base font-semibold text-zinc-200">Tap or Drop PDF here</span>
                         <span className="text-sm text-zinc-500 max-w-[300px]">Features precise unicode metadata extraction for accurate native font replacement.</span>
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
                    {/* PC/Tablet Editor Toolbar */}
                    <div className="h-14 bg-zinc-950/80 border-b border-zinc-900 flex items-center justify-between px-4 shrink-0 shadow-sm relative z-10 w-full min-h-[44px]">
                       <span className="text-xs text-zinc-400 font-mono truncate max-w-[150px] sm:max-w-xs">{file.name}</span>
                       <div className="flex items-center gap-2 sm:gap-3 bg-zinc-900 rounded-lg p-1 border border-zinc-800 shadow-inner">
                          <button disabled={currentPage <= 1 || isRendering} onClick={() => setCurrentPage(c=>c-1)} className="p-1 min-w-[44px] min-h-[44px] hover:bg-zinc-800 rounded flex items-center justify-center disabled:opacity-30"><ChevronLeft className="w-5 h-5 text-zinc-300"/></button>
                          <span className="text-[10px] font-mono tracking-widest text-zinc-400 font-bold px-2 whitespace-nowrap">PAGE {currentPage}/{numPages}</span>
                          <button disabled={currentPage >= numPages || isRendering} onClick={() => setCurrentPage(c=>c+1)} className="p-1 min-w-[44px] min-h-[44px] hover:bg-zinc-800 rounded flex items-center justify-center disabled:opacity-30"><ChevronRight className="w-5 h-5 text-zinc-300"/></button>
                       </div>
                    </div>
                    
                    {/* Hardware Accelerated Canvas Viewport */}
                    <div className="flex-1 overflow-auto p-4 lg:p-8 flex justify-center bg-zinc-900 lg:bg-zinc-800/20" id="pdf-viewport">
                       <div 
                         className="relative inline-block max-w-full shadow-2xl bg-white cursor-crosshair transform-gpu origin-top ring-1 ring-zinc-800 min-h-[300px] min-w-[200px]"
                         onClick={handleCanvasInteraction}
                       >
                           {isRendering && (
                              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/10 z-10 backdrop-blur-[1px]">
                                 <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                              </div>
                           )}
                           
                           <canvas ref={canvasRef} className="max-w-[100vw] lg:max-w-full h-auto block" />
                           
                           {/* Client-Side Edit Preview Overlays */}
                           {pdfDimensions && edits.filter(e => e.page === currentPage).map(edit => (
                              <div key={edit.id}>
                                  {/* Visually trace the masking frame for replacement tracking */}
                                  {edit.isReplacement && (
                                     <div 
                                        style={{
                                            position: 'absolute',
                                            left: `${(edit.maskPdfX / pdfDimensions.w) * 100}%`,
                                            top: `${(1 - ((edit.maskPdfY + edit.maskPdfH) / pdfDimensions.h)) * 100}%`,
                                            width: `${(edit.maskPdfW / pdfDimensions.w) * 100}%`,
                                            height: `${(edit.maskPdfH / pdfDimensions.h) * 100}%`,
                                        }}
                                        className="bg-white border-2 border-dashed border-zinc-300/30 backdrop-blur-sm z-0"
                                     />
                                  )}
                                  
                                  {/* Render Adjusted Output Text string placement */}
                                  <div 
                                     style={{ 
                                        position: 'absolute', 
                                        left: `${(edit.pdfX / pdfDimensions.w) * 100}%`, 
                                        top: `${(1 - (edit.pdfY / pdfDimensions.h)) * 100}%`,
                                        color: edit.color,
                                        fontSize: 'clamp(10px, 1.8vw, 24px)',
                                        transform: 'translate(0%, -100%)',
                                        lineHeight: 1.2,
                                        whiteSpace: 'pre'
                                     }}
                                     className="group z-10 border border-transparent hover:border-dashed hover:border-red-500/80 hover:bg-red-500/5 rounded transition-colors cursor-pointer"
                                     onClick={(e) => {
                                        e.stopPropagation();
                                        setEdits(edits.filter(x => x.id !== edit.id));
                                     }}
                                  >
                                     <span className="absolute -top-3 -right-3 bg-red-600 text-white rounded-full p-1.5 hidden group-hover:flex z-20 shadow-lg min-w-[40px] min-h-[40px] items-center justify-center">
                                        <X className="w-5 h-5" />
                                     </span>
                                     {edit.text}
                                  </div>
                              </div>
                           ))}
                       </div>
                    </div>
                 </div>
             )}
          </div>

          {/* SECTION B: ADVANCED UNICODE GRAPHESIS SUMMARIZER DASHBOARD */}
          <div className={cn(
             "h-full w-full lg:w-[480px] xl:w-[540px] bg-zinc-950 lg:border-l border-zinc-900 flex-col shrink-0 lg:flex shadow-2xl relative",
             activeTab === 'summary' ? "flex" : "hidden"
          )}>
             <div className="p-4 lg:p-5 border-b border-zinc-900 flex items-center justify-between shrink-0 h-16 bg-zinc-900/50">
                <div className="flex items-center gap-3">
                   <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                       <LayoutTemplate className="w-4 h-4" />
                   </div>
                   <div className="flex flex-col">
                       <span className="text-xs font-bold uppercase tracking-widest text-zinc-100">Linguistic Framework</span>
                       <span className="text-[10px] text-zinc-500 font-mono mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">Statistical extraction via Unicode density</span>
                   </div>
                </div>
             </div>
             
             <div className="flex-1 overflow-y-auto p-5 relative pb-28 md:pb-6">
                 {!file && (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-center px-4 min-h-[300px]">
                      <FileText className="w-12 h-12 mb-5 text-zinc-800 stroke-[1.5]" />
                      <p className="text-sm font-bold text-zinc-400">Offline Parser Inactive</p>
                      <p className="text-xs mt-2 max-w-[250px] leading-relaxed">Provide a document to test semantic reconstruction and frequency indexing offline.</p>
                    </div>
                 )}

                 {isSummarizing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-md z-10 p-6 text-center">
                       <div className="relative">
                           <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
                       </div>
                       <h3 className="text-sm font-bold text-white mb-1 tracking-wide">Executing Graphesis</h3>
                       <p className="text-[10px] uppercase font-mono tracking-widest text-zinc-500">Unpacking token density blocks mapping script domains</p>
                    </div>
                 )}

                 {file && !isSummarizing && summaryData && (
                    <div className="space-y-6 flex flex-col gap-2">
                      
                      {/* Structure Zone 1: Core Objective */}
                      <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-xl p-5 mb-2 shadow-inner group transition-all">
                          <h3 className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse"></div>
                             Core Document Objective
                          </h3>
                          <p className="text-sm text-zinc-200 leading-relaxed font-serif pt-1 pl-1 border-l border-emerald-800/50">
                             {summaryData.objective}
                          </p>
                      </div>
                      
                      {/* Structure Zone 2: Key Data Points */}
                      <div className="space-y-4">
                        <h3 className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest pl-1 mt-4">Key Data Points & Structural Insights</h3>
                        {summaryData.keyPoints.map((sentence, i) => (
                          <div key={i} className="py-2.5 px-4 bg-zinc-900/40 border border-zinc-800/60 rounded-xl relative group">
                             <span className="absolute left-4 top-4 w-1.5 h-1.5 rounded bg-zinc-700"></span>
                             <p className="text-xs text-zinc-400 leading-relaxed font-serif pl-4">
                               {sentence}
                             </p>
                          </div>
                        ))}
                      </div>

                      {/* Structure Zone 3: Contextual Vocabulary Array */}
                      <div className="pt-6 border-t border-zinc-900 mt-4 space-y-4">
                         <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest pl-1">Contextual Vocabulary Clusters</h3>
                         <div className="flex flex-wrap gap-2">
                            {summaryData.vocabulary.map((vocabItem, i) => (
                               <span key={i} className="text-xs px-3 py-1.5 bg-zinc-900 border border-zinc-800/80 rounded-lg text-zinc-300 font-mono hover:bg-zinc-800 transition-colors cursor-default whitespace-nowrap inline-flex">
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

      {/* SECURE OVERRIDE MODAL: Mobile + Desktop Touch form */}
      {activeInput && (
         <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
              onClick={() => setActiveInput(null)}>
            <div className="w-full max-w-[420px] bg-zinc-950 border border-zinc-800 p-6 rounded-2xl shadow-2xl flex flex-col gap-5"
                 onClick={e => e.stopPropagation()}>
                 
                 <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
                    <div className="flex items-center gap-2">
                       {activeInput.isReplacement ? <Eraser className="w-5 h-5 text-orange-400" /> : <Type className="w-5 h-5 text-indigo-400" />}
                       <span className="text-[13px] font-bold text-white uppercase tracking-widest">
                          {activeInput.isReplacement ? "Override Metadata Matrix" : "Inject Text segment"}
                       </span>
                    </div>
                    <button onClick={() => setActiveInput(null)} className="p-3 bg-zinc-900 hover:bg-zinc-800 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"><X className="w-5 h-5 text-zinc-400"/></button>
                 </div>
                 
                 <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase mb-1">String Data (EN / \p&#123;Script=Bengali&#125;)</label>
                    <textarea
                      value={activeInput.text}
                      onChange={e => setActiveInput({...activeInput, text: e.target.value})}
                      autoFocus
                      className="w-full h-[100px] bg-zinc-900 border border-zinc-700/50 rounded-xl p-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none transition-all shadow-inner"
                      placeholder="Enter typography payload..."
                    />
                 </div>
                 
                 {/* Metadata Config Override Control Panel */}
                 <div className="flex flex-col gap-3">
                     <button type="button" onClick={() => setShowConfigOptions(!showConfigOptions)} className="flex items-center gap-2 py-2 text-[10px] font-mono tracking-widest uppercase text-indigo-400 bg-transparent min-h-[44px] min-w-[44px]">
                         <Settings2 className="w-4 h-4" /> 
                         {showConfigOptions ? "Collapse Options" : "View Extracted Config "}
                     </button>

                     {showConfigOptions && (
                        <div className="grid grid-cols-2 gap-4 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800/80 animate-in slide-in-from-top-2 duration-300">
                            
                            <div className="col-span-2 flex flex-col gap-2">
                               <label className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase truncate">Source Font Profile</label>
                               <div className="h-11 bg-zinc-950 border border-zinc-700/50 rounded-lg px-3 flex items-center text-xs text-zinc-400 font-mono">
                                  {activeInput.fontFamily} (Detected)
                               </div>
                            </div>

                            <div className="flex flex-col gap-2">
                               <label className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">Paint Hex Override</label>
                               <input type="color" value={activeInput.color} onChange={e => setActiveInput({...activeInput, color: e.target.value})} className="w-full h-11 p-1 rounded-lg border border-zinc-700 bg-zinc-900 cursor-pointer min-h-[44px]" />
                            </div>

                            <div className="flex flex-col gap-2">
                               <label className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">Point Size Override</label>
                               <input type="number" min="8" max="144" value={activeInput.size} onChange={e => setActiveInput({...activeInput, size: parseInt(e.target.value) || 14})} className="w-full h-11 bg-zinc-900 border border-zinc-700 rounded-lg px-3 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 min-h-[44px] text-center" />
                            </div>
                        </div>
                     )}
                 </div>
                 
                 <button 
                   onClick={commitActiveInput}
                   disabled={!activeInput.text.trim()}
                   className="w-full mt-2 py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none text-white text-[11px] font-bold tracking-widest uppercase rounded-xl transition-all active:scale-[0.98] min-h-[44px] shadow-[0_0_20px_rgba(79,70,229,0.25)]"
                 >
                   Commit Coordinates & Mask
                 </button>
            </div>
         </div>
      )}

      {/* MOBILE: BOTTOM NAVIGATION TAB BAR */}
      <div className="flex lg:hidden bg-zinc-950 border-t border-zinc-900 shrink-0 shadow-[0_-10px_20px_rgba(0,0,0,0.4)] pb-safe z-40 fixed bottom-0 left-0 right-0 h-[64px]">
          <button 
             onClick={() => setActiveTab('editor')} 
             className={cn(
                "flex-1 py-3 flex flex-col items-center justify-center gap-1.5 transition-colors min-h-[64px]", 
                activeTab === 'editor' ? "text-indigo-400 bg-indigo-900/10" : "text-zinc-500 hover:text-zinc-300"
             )}
          >
             <PenTool className="w-5 h-5" />
             <span className="text-[10px] font-bold uppercase tracking-wider">Workspace</span>
          </button>
          
          <div className="w-px bg-zinc-900 my-2"></div>
          
          <button 
             onClick={() => setActiveTab('summary')} 
             className={cn(
                "flex-1 py-3 flex flex-col items-center justify-center gap-1.5 transition-colors min-h-[64px]", 
                activeTab === 'summary' ? "text-emerald-400 bg-emerald-900/10" : "text-zinc-500 hover:text-zinc-300"
             )}
          >
             <LayoutTemplate className="w-5 h-5" />
             <span className="text-[10px] font-bold uppercase tracking-wider">Intelligence Array</span>
          </button>
      </div>

    </div>
  );
}
