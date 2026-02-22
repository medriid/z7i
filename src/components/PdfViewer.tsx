import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, Maximize2 } from 'lucide-react';

type PdfViewerProps = {
  src: string;
  fileName?: string;
  initialPage?: number;
  compact?: boolean;
  maxHeight?: number;
  onPageChange?: (page: number) => void;
};

const WORKER_SRC = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs`;

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      return mod;
    });
  }
  return pdfjsPromise;
}

export function PdfViewer({
  src,
  fileName,
  initialPage = 1,
  compact = false,
  maxHeight = 600,
  onPageChange,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // load document only once
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const pdfjs = await loadPdfjs();

        let loadSrc: string | Uint8Array = src;
        // convert to typed array for pdfjs
        if (src.startsWith('data:')) {
          const base64 = src.split(',')[1];
          if (base64) {
            const bin = atob(base64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            loadSrc = arr;
          }
        }

        const doc = await pdfjs.getDocument(loadSrc as any).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setTotalPages(doc.numPages);
        setPage(prev => Math.min(prev, doc.numPages));
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('PDF load error', err);
          setError('Failed to load PDF.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (docRef.current) {
        docRef.current.destroy();
        docRef.current = null;
      }
    };
  }, [src]);

  // render
  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || loading) return;

    try {
      // cancel in-flight renderer thing
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const pageObj = await doc.getPage(page);
      const viewport = pageObj.getViewport({ scale });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = pageObj.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('PDF render error', err);
      }
    }
  }, [page, scale, loading]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  const goPage = (delta: number) => {
    setPage(prev => {
      const next = Math.max(1, Math.min(totalPages, prev + delta));
      onPageChange?.(next);
      return next;
    });
  };

  const adjustScale = (delta: number) => {
    setScale(prev => Math.max(0.5, Math.min(4, +(prev + delta).toFixed(2))));
  };

  const openInNewTab = () => {
    window.open(src, '_blank', 'noopener');
  };

  if (loading) {
    return (
      <div className="pdf-viewer pdf-viewer--loading">
        <span className="spinner" /> Loading PDF…
      </div>
    );
  }

  if (error) {
    return (
      <div className="pdf-viewer pdf-viewer--error">
        <p>{error}</p>
        <a className="btn btn-secondary btn-small" href={src} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      <div className={`pdf-toolbar ${compact ? 'pdf-toolbar--compact' : ''}`}>
        <div className="pdf-toolbar-left">
          {fileName && !compact && <span className="pdf-toolbar-name">{fileName}</span>}
          <div className="pdf-nav">
            <button
              type="button"
              className="pdf-nav-btn"
              onClick={() => goPage(-1)}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={compact ? 14 : 16} />
            </button>
            <span className="pdf-page-label">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="pdf-nav-btn"
              onClick={() => goPage(1)}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight size={compact ? 14 : 16} />
            </button>
          </div>
        </div>
        <div className="pdf-toolbar-right">
          <button type="button" className="pdf-nav-btn" onClick={() => adjustScale(-0.25)} aria-label="Zoom out">
            <ZoomOut size={compact ? 13 : 15} />
          </button>
          <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
          <button type="button" className="pdf-nav-btn" onClick={() => adjustScale(0.25)} aria-label="Zoom in">
            <ZoomIn size={compact ? 13 : 15} />
          </button>
          {!compact && (
            <>
              <button type="button" className="pdf-nav-btn" onClick={openInNewTab} aria-label="Open full screen">
                <Maximize2 size={15} />
              </button>
              {!src.startsWith('data:') && (
                <a className="pdf-nav-btn" href={src} download={fileName} aria-label="Download">
                  <Download size={15} />
                </a>
              )}
            </>
          )}
        </div>
      </div>
      <div ref={containerRef} className="pdf-canvas-wrap" style={{ maxHeight }}>
        <canvas ref={canvasRef} className="pdf-canvas" />
      </div>
    </div>
  );
}

export default PdfViewer;