import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  Highlighter,
  Import,
  ListPlus,
  MousePointer2,
  PanelsLeftBottom,
  PenTool,
  Plus,
  ScanSearch,
  StickyNote,
  Type,
  Upload,
} from 'lucide-react';
import PdfViewer from './components/PdfViewer';

type ZoneMode = 'select' | 'text' | 'draw';

type ZoneListItem = {
  id: string;
  name: string;
  color: string;
};

type ImportedItem = {
  id: string;
  type: 'text' | 'sticky' | 'image' | 'pdf' | 'question';
  x: number;
  y: number;
  width?: number;
  height?: number;
  content: string;
  htmlContent?: string;
  sourceLabel?: string;
  url?: string;
  page?: number;
};

type PickerItem = { id: string; name: string; count?: number };
type PyqQuestionLite = { id: string; questionHtml: string; subject?: string; chapter?: string; pyqInfo?: string };
type Z7iBookmarkLite = { id: string; questionId: string; question: { questionHtml: string; subject: string }; test: { testName: string; id: string } };

type StrokePoint = { x: number; y: number };
type Stroke = { id: string; points: StrokePoint[]; color: string; width: number };

type ZoneData = {
  items: ImportedItem[];
  strokes: Stroke[];
  cameraX: number;
  cameraY: number;
  cameraScale: number;
};

type ZoneWorkspacePayload = {
  zones: ZoneListItem[];
  activeZoneId: string;
  zoneData: Record<string, ZoneData>;
};

type TestLite = { id: string; testName: string; packageName: string };

const DEFAULT_ZONE_ID = 'zone-default';
const ZONE_COLORS = ['#6d8fff', '#33c3a7', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6'];
const PYQ_BOOKMARK_STORAGE_KEY = 'pyq-question-bookmarks';

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

const distanceBetween = (a: StrokePoint, b: StrokePoint) => Math.hypot(a.x - b.x, a.y - b.y);

const simplifyStroke = (points: StrokePoint[], epsilon = 12): StrokePoint[] => {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let index = -1;
  let maxDistance = 0;

  const lineLength = distanceBetween(first, last) || 1;
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    const area = Math.abs(
      (last.x - first.x) * (first.y - point.y) - (first.x - point.x) * (last.y - first.y)
    );
    const distance = area / lineLength;
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance > epsilon && index !== -1) {
    const left = simplifyStroke(points.slice(0, index + 1), epsilon);
    const right = simplifyStroke(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
};

const makeCirclePoints = (center: StrokePoint, radius: number, count = 36) =>
  Array.from({ length: count + 1 }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });

const regularizeStroke = (points: StrokePoint[]): StrokePoint[] => {
  if (points.length < 8) return points;

  const first = points[0];
  const last = points[points.length - 1];
  const isClosed = distanceBetween(first, last) < 26;

  if (!isClosed) {
    const simplified = simplifyStroke(points, 8);
    if (simplified.length === 2) return simplified;
    return points;
  }

  const count = points.length;
  const center = points.reduce((acc, point) => ({ x: acc.x + point.x / count, y: acc.y + point.y / count }), { x: 0, y: 0 });
  const radii = points.map(point => distanceBetween(point, center));
  const meanRadius = radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  const radiusVariance = radii.reduce((sum, radius) => sum + (radius - meanRadius) ** 2, 0) / radii.length;
  const radiusStd = Math.sqrt(radiusVariance);

  if (meanRadius > 18 && radiusStd / meanRadius < 0.25) {
    return makeCirclePoints(center, meanRadius);
  }

  const simplified = simplifyStroke([...points, first], 13);
  const deduped = simplified.filter((point, index, array) => index === 0 || distanceBetween(point, array[index - 1]) > 10);
  const cornerCount = deduped.length - 1;
  if (cornerCount >= 3 && cornerCount <= 8) {
    const snapped = deduped.slice(0, -1);
    return [...snapped, snapped[0]];
  }

  return points;
};

export function ZonePage({ tests, onBack }: { tests: TestLite[]; onBack: () => void }) {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mode, setMode] = useState<ZoneMode>('select');
  const [zones, setZones] = useState<ZoneListItem[]>([
    { id: DEFAULT_ZONE_ID, name: 'Default Zone', color: ZONE_COLORS[0] },
  ]);
  const [activeZoneId, setActiveZoneId] = useState(DEFAULT_ZONE_ID);
  const [zoneData, setZoneData] = useState<Record<string, ZoneData>>({
    [DEFAULT_ZONE_ID]: { items: [], strokes: [], cameraX: 0, cameraY: 0, cameraScale: 1 },
  });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, baseX: 0, baseY: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [importSource, setImportSource] = useState<'files' | 'pyq' | 'z7i'>('files');
  const [pyqExams, setPyqExams] = useState<PickerItem[]>([]);
  const [pyqSubjects, setPyqSubjects] = useState<PickerItem[]>([]);
  const [pyqChapters, setPyqChapters] = useState<PickerItem[]>([]);
  const [pyqBookmarkedQuestions, setPyqBookmarkedQuestions] = useState<PyqQuestionLite[]>([]);
  const [selectedPyqExam, setSelectedPyqExam] = useState<string>('');
  const [selectedPyqSubject, setSelectedPyqSubject] = useState<string>('');
  const [selectedPyqChapter, setSelectedPyqChapter] = useState<string>('');
  const [z7iBookmarks, setZ7iBookmarks] = useState<Z7iBookmarkLite[]>([]);
  const [selectedZ7iTest, setSelectedZ7iTest] = useState<string>('');
  const [activeZoneEditId, setActiveZoneEditId] = useState<string | null>(null);
  const [pressTimer, setPressTimer] = useState<number | null>(null);
  const [itemPressTimer, setItemPressTimer] = useState<number | null>(null);
  const [drawHue, setDrawHue] = useState(216);
  const [drawSaturation, setDrawSaturation] = useState(80);
  const [drawLightness, setDrawLightness] = useState(56);
  const [drawLineWidth, setDrawLineWidth] = useState(3);
  const [drawPanelOpen, setDrawPanelOpen] = useState(false);
  const [zoneHydrated, setZoneHydrated] = useState(false);
  const pinchStateRef = useRef<{ pointerA: number; pointerB: number; distance: number; scale: number } | null>(null);
  const pointerPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const drawStrokeColor = useMemo(
    () => `hsl(${drawHue} ${drawSaturation}% ${drawLightness}%)`,
    [drawHue, drawSaturation, drawLightness]
  );

  const activeZone = useMemo(
    () => zoneData[activeZoneId] ?? { items: [], strokes: [], cameraX: 0, cameraY: 0, cameraScale: 1 },
    [activeZoneId, zoneData]
  );

  const updateActiveZone = (updater: (zone: ZoneData) => ZoneData) => {
    setZoneData(prev => ({
      ...prev,
      [activeZoneId]: updater(prev[activeZoneId] ?? { items: [], strokes: [], cameraX: 0, cameraY: 0, cameraScale: 1 }),
    }));
  };

  const getAuthHeaders = (): Record<string, string> => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token') || localStorage.getItem('authToken') || '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const apiFetch = async (url: string) => {
    const response = await fetch(url, { headers: { ...getAuthHeaders() } });
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    return response.json();
  };

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/z7i?action=zone-workspace')
      .then(data => {
        if (cancelled || !data?.workspace) return;
        const workspace = data.workspace as ZoneWorkspacePayload;
        if (!Array.isArray(workspace.zones) || !workspace.activeZoneId || !workspace.zoneData) return;
        setZones(workspace.zones);
        setZoneData(workspace.zoneData);
        setActiveZoneId(workspace.activeZoneId);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setZoneHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!zoneHydrated) return;
    const timer = window.setTimeout(async () => {
      try {
        await fetch('/api/z7i?action=zone-workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ zones, activeZoneId, zoneData }),
        });
      } catch {
        // ignore autosave failures to keep workspace responsive
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeZoneId, zoneData, zones, zoneHydrated]);

  const toPreviewText = (value: string) =>
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  useEffect(() => {
    if (!importPanelOpen || importSource !== 'pyq') return;
    apiFetch('/api/pyq?action=exams')
      .then(data => setPyqExams(data?.data?.items ?? []))
      .catch(() => setPyqExams([]));
  }, [importPanelOpen, importSource]);

  useEffect(() => {
    if (!selectedPyqExam) {
      setPyqSubjects([]);
      return;
    }
    apiFetch(`/api/pyq?action=subjects&examId=${encodeURIComponent(selectedPyqExam)}`)
      .then(data => setPyqSubjects(data?.data?.items ?? []))
      .catch(() => setPyqSubjects([]));
  }, [selectedPyqExam]);

  useEffect(() => {
    if (!selectedPyqExam || !selectedPyqSubject) {
      setPyqChapters([]);
      return;
    }
    apiFetch(
      `/api/pyq?action=chapters&examId=${encodeURIComponent(selectedPyqExam)}&subjectId=${encodeURIComponent(selectedPyqSubject)}`
    )
      .then(data => setPyqChapters(data?.data?.items ?? []))
      .catch(() => setPyqChapters([]));
  }, [selectedPyqExam, selectedPyqSubject]);

  useEffect(() => {
    if (!selectedPyqExam || !selectedPyqSubject || !selectedPyqChapter) {
      setPyqBookmarkedQuestions([]);
      return;
    }

    const savedBookmarksRaw = typeof window !== 'undefined' ? localStorage.getItem(PYQ_BOOKMARK_STORAGE_KEY) : null;
    let bookmarkMap: Record<string, boolean> = {};
    if (savedBookmarksRaw) {
      try {
        bookmarkMap = JSON.parse(savedBookmarksRaw) as Record<string, boolean>;
      } catch {
        bookmarkMap = {};
      }
    }

    apiFetch(
      `/api/pyq?action=questions&examId=${encodeURIComponent(selectedPyqExam)}&subjectId=${encodeURIComponent(selectedPyqSubject)}&chapterId=${encodeURIComponent(selectedPyqChapter)}`
    )
      .then(data => {
        const allQuestions = (data?.data?.items ?? []) as PyqQuestionLite[];
        setPyqBookmarkedQuestions(allQuestions.filter(question => Boolean(bookmarkMap[question.id])));
      })
      .catch(() => setPyqBookmarkedQuestions([]));
  }, [selectedPyqExam, selectedPyqSubject, selectedPyqChapter]);

  useEffect(() => {
    if (!importPanelOpen || importSource !== 'z7i') return;
    apiFetch('/api/z7i?action=bookmarks')
      .then(data => setZ7iBookmarks(data?.bookmarks ?? []))
      .catch(() => setZ7iBookmarks([]));
  }, [importPanelOpen, importSource]);

  const addZone = () => {
    const name = window.prompt('Name your new zone', `Zone ${zones.length + 1}`)?.trim();
    if (!name) return;
    const color = ZONE_COLORS[zones.length % ZONE_COLORS.length];
    const id = `zone-${newId()}`;
    setZones(prev => [...prev, { id, name, color }]);
    setZoneData(prev => ({ ...prev, [id]: { items: [], strokes: [], cameraX: 0, cameraY: 0, cameraScale: 1 } }));
    setActiveZoneId(id);
  };

  const renameZone = (zoneId: string) => {
    const current = zones.find(zone => zone.id === zoneId);
    const next = window.prompt('Rename zone', current?.name || '');
    if (!next?.trim()) return;
    setZones(prev => prev.map(zone => (zone.id === zoneId ? { ...zone, name: next.trim() } : zone)));
  };

  const setZoneColor = (zoneId: string, color: string) => {
    setZones(prev => prev.map(zone => (zone.id === zoneId ? { ...zone, color } : zone)));
  };

  const appendItem = (item: ImportedItem) => updateActiveZone(zone => ({ ...zone, items: [...zone.items, item] }));

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    files.forEach((file, index) => {
      const baseX = (-activeZone.cameraX + 120 + index * 36) / activeZone.cameraScale;
      const baseY = (-activeZone.cameraY + 120 + index * 36) / activeZone.cameraScale;
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          appendItem({
            id: `item-${newId()}`,
            type: 'image',
            content: file.name,
            sourceLabel: 'Upload',
            url: String(reader.result),
            x: baseX,
            y: baseY,
            width: 280,
            height: 180,
          });
        };
        reader.readAsDataURL(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        appendItem({
          id: `item-${newId()}`,
          type: 'pdf',
          content: file.name,
          sourceLabel: 'Upload',
          x: baseX,
          y: baseY,
          width: 420,
          url: String(reader.result),
          page: 1,
        });
      };
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  };

  const importQuestionCard = (content: string, sourceLabel: string, htmlContent?: string) => {
    appendItem({
      id: `item-${newId()}`,
      type: 'question',
      content,
      htmlContent,
      sourceLabel,
      x: (-activeZone.cameraX + 160) / activeZone.cameraScale,
      y: (-activeZone.cameraY + 150) / activeZone.cameraScale,
      width: 360,
    });
  };

  const getWorkspacePoint = (clientX: number, clientY: number, element: HTMLDivElement) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - activeZone.cameraX) / activeZone.cameraScale,
      y: (clientY - bounds.top - activeZone.cameraY) / activeZone.cameraScale,
    };
  };

  const handleWorkspaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'text' || !workspaceRef.current) return;
    const point = getWorkspacePoint(event.clientX, event.clientY, workspaceRef.current);
    const text = window.prompt('Text block content');
    if (!text?.trim()) return;
    appendItem({ id: `item-${newId()}`, type: 'text', content: text.trim(), x: point.x, y: point.y, width: 280 });
  };

  const editTextItem = (itemId: string) => {
    if (mode !== 'text') return;
    const existing = activeZone.items.find(item => item.id === itemId);
    if (!existing || (existing.type !== 'text' && existing.type !== 'sticky')) return;
    const next = window.prompt('Edit text', existing.content);
    if (!next?.trim()) return;
    updateActiveZone(zone => ({
      ...zone,
      items: zone.items.map(item => (item.id === itemId ? { ...item, content: next.trim() } : item)),
    }));
  };

  const beginZonePress = (zoneId: string) => {
    const timer = window.setTimeout(() => {
      setActiveZoneEditId(zoneId);
    }, 380);
    setPressTimer(timer);
  };

  const cancelZonePress = () => {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      setPressTimer(null);
    }
  };

  const handleColorWheelPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const cx = bounds.width / 2;
    const cy = bounds.height / 2;
    const dx = event.clientX - bounds.left - cx;
    const dy = event.clientY - bounds.top - cy;
    const radius = Math.min(bounds.width, bounds.height) / 2;
    const distance = Math.min(Math.hypot(dx, dy), radius);
    const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 180;
    setDrawHue(hue);
    setDrawSaturation(Math.round((distance / radius) * 100));
  };

  const zoomToViewportCenter = (newScale: number) => {
    const el = workspaceRef.current;
    if (!el) { updateActiveZone(zone => ({ ...zone, cameraScale: newScale })); return; }
    const rect = el.getBoundingClientRect();
    const vcx = rect.width / 2;
    const vcy = rect.height / 2;
    updateActiveZone(zone => {
      const oldScale = zone.cameraScale;
      const worldX = (vcx - zone.cameraX) / oldScale;
      const worldY = (vcy - zone.cameraY) / oldScale;
      return {
        ...zone,
        cameraScale: newScale,
        cameraX: vcx - worldX * newScale,
        cameraY: vcy - worldY * newScale,
      };
    });
  };

  const handlePinchZoom = () => {
    const pointers = Array.from(pointerPositionsRef.current.entries());
    if (pointers.length < 2) {
      pinchStateRef.current = null;
      return;
    }
    const [[aId, a], [bId, b]] = pointers;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const pinch = pinchStateRef.current;
    if (!pinch || pinch.pointerA !== aId || pinch.pointerB !== bId) {
      pinchStateRef.current = { pointerA: aId, pointerB: bId, distance, scale: activeZone.cameraScale };
      return;
    }
    const nextScale = Math.max(0.45, Math.min(3.2, (distance / pinch.distance) * pinch.scale));
    zoomToViewportCenter(nextScale);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerPositionsRef.current.size >= 2) {
      handlePinchZoom();
      return;
    }

    if (mode === 'draw') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = getWorkspacePoint(event.clientX, event.clientY, event.currentTarget);
      setIsDrawing(true);
      updateActiveZone(zone => ({
        ...zone,
        strokes: [...zone.strokes, { id: `stroke-${newId()}`, points: [point], color: drawStrokeColor, width: drawLineWidth }],
      }));
      return;
    }

    setIsPanning(true);
    setPanStart({ x: event.clientX, y: event.clientY, baseX: activeZone.cameraX, baseY: activeZone.cameraY });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerPositionsRef.current.size >= 2) {
      handlePinchZoom();
      return;
    }

    if (isDrawing && mode === 'draw') {
      event.preventDefault();
      const point = getWorkspacePoint(event.clientX, event.clientY, event.currentTarget);
      updateActiveZone(zone => {
        if (zone.strokes.length === 0) return zone;
        const nextStrokes = [...zone.strokes];
        const last = nextStrokes[nextStrokes.length - 1];
        nextStrokes[nextStrokes.length - 1] = { ...last, points: [...last.points, point] };
        return { ...zone, strokes: nextStrokes };
      });
      return;
    }

    if (!isPanning || mode === 'draw') return;
    updateActiveZone(zone => ({
      ...zone,
      cameraX: panStart.baseX + event.clientX - panStart.x,
      cameraY: panStart.baseY + event.clientY - panStart.y,
    }));
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const el = workspaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vcx = event.clientX - rect.left;
    const vcy = event.clientY - rect.top;
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    updateActiveZone(zone => {
      const newScale = Math.max(0.45, Math.min(3.2, zone.cameraScale + delta * zone.cameraScale));
      const worldX = (vcx - zone.cameraX) / zone.cameraScale;
      const worldY = (vcy - zone.cameraY) / zone.cameraScale;
      return {
        ...zone,
        cameraScale: newScale,
        cameraX: vcx - worldX * newScale,
        cameraY: vcy - worldY * newScale,
      };
    });
  };

  const endPointerAction = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerPositionsRef.current.delete(event.pointerId);
    if (pointerPositionsRef.current.size < 2) pinchStateRef.current = null;

    if (mode === 'draw' && isDrawing) {
      updateActiveZone(zone => {
        if (zone.strokes.length === 0) return zone;
        const nextStrokes = [...zone.strokes];
        const last = nextStrokes[nextStrokes.length - 1];
        nextStrokes[nextStrokes.length - 1] = { ...last, points: regularizeStroke(last.points) };
        return { ...zone, strokes: nextStrokes };
      });
    }
    setIsPanning(false);
    setIsDrawing(false);
  };

  const deleteMediaItem = (itemId: string) => {
    updateActiveZone(zone => ({ ...zone, items: zone.items.filter(item => item.id !== itemId) }));
  };

  const beginItemPress = (item: ImportedItem) => {
    if (item.type !== 'image' && item.type !== 'pdf') return;
    const timer = window.setTimeout(() => {
      const confirmed = window.confirm(`Delete ${item.content}?`);
      if (confirmed) deleteMediaItem(item.id);
    }, 520);
    setItemPressTimer(timer);
  };

  const cancelItemPress = () => {
    if (itemPressTimer) {
      window.clearTimeout(itemPressTimer);
      setItemPressTimer(null);
    }
  };

  return (
    <div className="zone-page">
      <aside className={`zone-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="zone-sidebar-header">
          <button className="btn btn-secondary btn-small" onClick={onBack}><ChevronLeft size={14} /> Back</button>
          <button className="icon-btn" onClick={() => setSidebarOpen(false)}><ChevronLeft size={16} /></button>
        </div>
        <div className="zone-list">
          {zones.map(zone => (
            <div
              key={zone.id}
              className={`zone-list-item ${zone.id === activeZoneId ? 'active' : ''}`}
              style={{ borderColor: zone.color }}
            >
              <button
                className="zone-list-main"
                onClick={() => setActiveZoneId(zone.id)}
                onPointerDown={() => beginZonePress(zone.id)}
                onPointerUp={cancelZonePress}
                onPointerLeave={cancelZonePress}
              >
                <span className="zone-dot" style={{ backgroundColor: zone.color }} />
                <span>{zone.name}</span>
              </button>
              {activeZoneEditId === zone.id && (
                <div className="zone-sidebar-edit">
                  <button className="icon-btn" onClick={() => renameZone(zone.id)}><Type size={14} /></button>
                  <div className="zone-color-palette">
                    {ZONE_COLORS.map(color => (
                      <button key={color} className="zone-color-dot" style={{ backgroundColor: color }} onClick={() => setZoneColor(zone.id, color)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <button className="btn btn-primary" onClick={addZone}><Plus size={14} /> New Zone</button>
      </aside>

      {!sidebarOpen && (
        <button className="zone-sidebar-open-btn" onClick={() => setSidebarOpen(true)}>
          <PanelsLeftBottom size={18} />
          <span>Zones</span>
          <ChevronRight size={14} />
        </button>
      )}

      <main
        ref={workspaceRef}
        className={`zone-workspace ${mode === 'draw' ? 'draw-mode' : ''}`}
        onClick={handleWorkspaceClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointerAction}
        onPointerLeave={endPointerAction}
        onWheel={handleWheel}
      >
        <div
          className="zone-dot-grid"
          style={{
            backgroundPosition: `${activeZone.cameraX}px ${activeZone.cameraY}px`,
            backgroundSize: `${26 * activeZone.cameraScale}px ${26 * activeZone.cameraScale}px`,
          }}
        />
        <div className="zone-canvas" style={{ transform: `translate(${activeZone.cameraX}px, ${activeZone.cameraY}px) scale(${activeZone.cameraScale})` }}>
          <svg className="zone-drawing-layer">
            {activeZone.strokes.map(stroke => (
              <polyline
                key={stroke.id}
                points={stroke.points.map(point => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </svg>

          {activeZone.items.map(item => (
            <div
              key={item.id}
              className={`zone-item zone-item-${item.type}`}
              style={{ left: item.x, top: item.y, width: item.width }}
              onClick={event => {
                if (mode !== 'text') return;
                event.stopPropagation();
                editTextItem(item.id);
              }}
              onPointerDown={() => beginItemPress(item)}
              onPointerUp={cancelItemPress}
              onPointerLeave={cancelItemPress}
              onContextMenu={event => {
                if (item.type !== 'image' && item.type !== 'pdf') return;
                event.preventDefault();
                const confirmed = window.confirm(`Delete ${item.content}?`);
                if (confirmed) deleteMediaItem(item.id);
              }}
            >
              {item.sourceLabel && <div className="zone-item-source">{item.sourceLabel}</div>}
              {item.type === 'image' && item.url ? (
                <img src={item.url} alt={item.content} style={{ width: '100%', height: item.height, objectFit: 'cover', borderRadius: 8 }} />
              ) : item.type === 'pdf' ? (
                <div className="zone-pdf-viewer">
                  <div className="zone-item-source-row">
                    <div className="zone-file-chip"><FileText size={16} /> {item.content}</div>
                  </div>
                  {item.url ? (
                    <PdfViewer
                      src={item.url}
                      fileName={item.content}
                      initialPage={item.page ?? 1}
                      compact
                      maxHeight={400}
                      onPageChange={(page) => updateActiveZone(zone => ({ ...zone, items: zone.items.map(existing => existing.id === item.id ? { ...existing, page } : existing) }))}
                    />
                  ) : (
                    <p>Preview unavailable</p>
                  )}
                </div>
              ) : (
                <p>{item.content}</p>
              )}
            </div>
          ))}
        </div>

        <div className="zone-right-toolbar" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <button className={`icon-btn ${mode === 'select' ? 'active' : ''}`} onClick={() => setMode('select')} title="Select/Move"><MousePointer2 size={16} /></button>
          <button className={`icon-btn ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')} title="Insert text"><Type size={16} /></button>
          <button className={`icon-btn ${mode === 'draw' ? 'active' : ''}`} onClick={() => setMode('draw')} title="Draw"><PenTool size={16} /></button>
          {mode === 'draw' && (
            <>
              <button className={`icon-btn ${drawPanelOpen ? 'active' : ''}`} onClick={() => setDrawPanelOpen(prev => !prev)} title="Brush settings"><Highlighter size={16} /></button>
              {drawPanelOpen && (
                <div className="draw-color-panel">
                  <div className="draw-color-preview" style={{ backgroundColor: drawStrokeColor }} />
                  <div className="draw-color-wheel" onPointerDown={handleColorWheelPointer} onPointerMove={event => event.buttons === 1 && handleColorWheelPointer(event)}>
                    <div className="draw-color-wheel-center" />
                  </div>
                  <label>Brightness<input type="range" min="15" max="80" value={drawLightness} onChange={event => setDrawLightness(Number(event.target.value))} /></label>
                  <label>Thickness<input type="range" min="1" max="18" value={drawLineWidth} onChange={event => setDrawLineWidth(Number(event.target.value))} /></label>
                </div>
              )}
            </>
          )}
          <button className="icon-btn" onClick={() => appendItem({ id: `item-${newId()}`, type: 'sticky', content: 'Sticky note', sourceLabel: 'Note', x: (-activeZone.cameraX + 120) / activeZone.cameraScale, y: (-activeZone.cameraY + 120) / activeZone.cameraScale, width: 220 })} title="Sticky note"><StickyNote size={16} /></button>
          <button className="icon-btn" onClick={() => updateActiveZone(zone => ({ ...zone, strokes: [] }))} title="Clear drawing"><Highlighter size={16} /></button>
        </div>

        <div className="zone-bottom-tools" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <button className="btn btn-secondary zone-import-trigger" onClick={() => setImportPanelOpen(prev => !prev)}>
            <Import size={15} /> Imports
          </button>
          {importPanelOpen && (
            <div className="zone-import-panel">
              <div className="zone-import-source-tabs">
                <button className={`btn btn-small ${importSource === 'files' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setImportSource('files')}><Upload size={13} /> File</button>
                <button className={`btn btn-small ${importSource === 'pyq' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setImportSource('pyq')}><BookOpenCheck size={13} /> PYQ</button>
                <button className={`btn btn-small ${importSource === 'z7i' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setImportSource('z7i')}><ListPlus size={13} /> Z7I Tests</button>
              </div>

              {importSource === 'files' && (
                <label className="btn btn-secondary file-import-btn">
                  <Upload size={15} /> Import PDF / PNG / JPEG
                  <input type="file" accept="application/pdf,image/png,image/jpeg" multiple onChange={importFiles} />
                </label>
              )}

              {importSource === 'pyq' && (
                <div className="zone-import-flow">
                  <select value={selectedPyqExam} onChange={event => { setSelectedPyqExam(event.target.value); setSelectedPyqSubject(''); setSelectedPyqChapter(''); }}>
                    <option value="">Select exam</option>
                    {pyqExams.map(exam => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
                  </select>
                  <select value={selectedPyqSubject} onChange={event => { setSelectedPyqSubject(event.target.value); setSelectedPyqChapter(''); }} disabled={!selectedPyqExam}>
                    <option value="">Select subject</option>
                    {pyqSubjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                  </select>
                  <select value={selectedPyqChapter} onChange={event => setSelectedPyqChapter(event.target.value)} disabled={!selectedPyqSubject}>
                    <option value="">Select chapter</option>
                    {pyqChapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}
                  </select>
                  <div className="zone-import-results">
                    {pyqBookmarkedQuestions.map(question => (
                      <button key={question.id} className="zone-import-question" onClick={() => importQuestionCard(toPreviewText(question.questionHtml).slice(0, 220), `PYQ · ${question.subject ?? ''}`, question.questionHtml)}>
                        <ScanSearch size={14} />
                        <span>{toPreviewText(question.questionHtml).slice(0, 140) || 'Question'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {importSource === 'z7i' && (
                <div className="zone-import-flow">
                  <select value={selectedZ7iTest} onChange={event => setSelectedZ7iTest(event.target.value)}>
                    <option value="">All tests</option>
                    {tests.map(test => <option key={test.id} value={test.id}>{test.testName}</option>)}
                  </select>
                  <div className="zone-import-results">
                    {z7iBookmarks
                      .filter(bookmark => !selectedZ7iTest || bookmark.test.id === selectedZ7iTest)
                      .map(bookmark => (
                        <button key={bookmark.id} className="zone-import-question" onClick={() => importQuestionCard(toPreviewText(bookmark.question.questionHtml).slice(0, 220), `Z7I · ${bookmark.test.testName}`, bookmark.question.questionHtml)}>
                          <ScanSearch size={14} />
                          <span>{toPreviewText(bookmark.question.questionHtml).slice(0, 140) || 'Question'}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
