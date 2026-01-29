import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PenTool, RotateCcw, Save, X } from 'lucide-react';
import {
  addSavedQuestionNote,
  createSavedQuestionId,
  DrawingStroke,
  LightboxContext,
  SavedQuestionNote,
} from '../utils/savedQuestionNotes';

function ImageLightbox({
  src,
  onClose,
  context,
}: {
  src: string;
  onClose: () => void;
  context?: LightboxContext;
}) {
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [note, setNote] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [strokeColor, setStrokeColor] = useState('#fbbf24');
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<DrawingStroke | null>(null);
  const strokesRef = useRef<DrawingStroke[]>([]);
  const colorPalette = useMemo(
    () => [
      '#fbbf24',
      '#f97316',
      '#ef4444',
      '#f59e0b',
      '#22c55e',
      '#14b8a6',
      '#3b82f6',
      '#6366f1',
      '#a855f7',
      '#ec4899',
      '#ffffff',
      '#111827',
    ],
    []
  );

  const getAccentColor = useCallback(() => {
    return (
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim() || '#fbbf24'
    );
  }, []);

  useEffect(() => {
    setStrokeColor(getAccentColor());
  }, [getAccentColor]);

  const drawStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    strokesRef.current.forEach((stroke) => {
      if (stroke.points.length < 2) return;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });
  }, []);

  const resizeCanvas = useCallback(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const rect = image.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    drawStrokes();
  }, [drawStrokes]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    resizeCanvas();

    const handleResize = () => resizeCanvas();
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
      window.removeEventListener('resize', handleResize);
    };
  }, [onClose, resizeCanvas]);

  const getRelativePoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    canvas?.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = getRelativePoint(event.clientX, event.clientY);
    const stroke: DrawingStroke = {
      color: strokeColor,
      size: 3,
      points: [point],
    };
    strokesRef.current.push(stroke);
    currentStrokeRef.current = stroke;
    drawStrokes();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled || !drawingRef.current || !currentStrokeRef.current) return;
    event.preventDefault();
    const nativeEvent = event.nativeEvent;
    const events =
      typeof nativeEvent.getCoalescedEvents === 'function' ? nativeEvent.getCoalescedEvents() : [nativeEvent];
    events.forEach((coalescedEvent) => {
      const point = getRelativePoint(coalescedEvent.clientX, coalescedEvent.clientY);
      currentStrokeRef.current?.points.push(point);
    });
    drawStrokes();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled) return;
    event.preventDefault();
    drawingRef.current = false;
    currentStrokeRef.current = null;
    const canvas = canvasRef.current;
    canvas?.releasePointerCapture(event.pointerId);
    drawStrokes();
  };

  const handleClearDrawing = () => {
    strokesRef.current = [];
    drawStrokes();
  };

  const handleSave = () => {
    if (!note.trim() && strokesRef.current.length === 0) {
      setSaveStatus('Add a note or draw before saving.');
      return;
    }
    const entry: SavedQuestionNote = {
      id: createSavedQuestionId(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      imageSrc: src,
      note: note.trim(),
      strokes: strokesRef.current,
      questionId: context?.questionId,
      label: context?.label,
      subject: context?.subject,
      testName: context?.testName,
    };
    addSavedQuestionNote(entry);
    setSaveStatus('Saved to Bookmarked Questions.');
  };

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>
        <X size={24} />
      </button>
      <div className="lightbox-toolbar" onClick={(event) => event.stopPropagation()}>
        <button
          className={`lightbox-tool ${drawingEnabled ? 'active' : ''}`}
          onClick={() => {
            setDrawingEnabled((prev) => !prev);
            setSaveStatus('');
          }}
          type="button"
        >
          <PenTool size={16} />
          {drawingEnabled ? 'Drawing' : 'Annotate'}
        </button>
        {drawingEnabled && (
          <>
            <div className="lightbox-color-picker">
              {colorPalette.map((color) => (
                <button
                  key={color}
                  className={`lightbox-color-swatch ${strokeColor === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setStrokeColor(color)}
                  type="button"
                  aria-label={`Select ${color} stroke`}
                />
              ))}
              <label className="lightbox-color-input" aria-label="Pick a custom color">
                <input type="color" value={strokeColor} onChange={(event) => setStrokeColor(event.target.value)} />
              </label>
            </div>
            <textarea
              className="lightbox-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a quick note..."
              rows={2}
            />
            <button className="lightbox-tool" onClick={handleClearDrawing} type="button">
              <RotateCcw size={16} />
              Clear
            </button>
            <button className="lightbox-tool primary" onClick={handleSave} type="button">
              <Save size={16} />
              Save
            </button>
          </>
        )}
        {saveStatus && <span className="lightbox-status">{saveStatus}</span>}
      </div>
      <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
        <div className="lightbox-media">
          <img ref={imageRef} src={src} alt="Enlarged view" className="lightbox-image" onLoad={resizeCanvas} />
          <canvas
            ref={canvasRef}
            className={`lightbox-canvas ${drawingEnabled ? 'active' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
      </div>
      <div className="lightbox-hint">Click anywhere or press ESC to close</div>
    </div>
  );
}

function useImageLightbox(context?: LightboxContext) {
  const [lightboxState, setLightboxState] = useState<{ src: string; context?: LightboxContext } | null>(null);

  const handleImageClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG') {
        e.preventDefault();
        e.stopPropagation();
        const src = (target as HTMLImageElement).src;
        setLightboxState({ src, context });
      }
    },
    [context]
  );

  const closeLightbox = useCallback(() => {
    setLightboxState(null);
  }, []);

  return { lightboxState, handleImageClick, closeLightbox };
}

export { ImageLightbox, useImageLightbox };
