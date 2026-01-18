import { useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { renderLatexInHtml } from './utils/latex';

export function AiDoubtPrompt({ questionId, aiSolution }: { questionId: string; aiSolution: string }) {
  const [doubt, setDoubt] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [model, setModel] = useState<'flash' | 'lite' | '3-12b' | '3-flash'>('flash');
  const API_BASE = import.meta.env.PROD ? '/api' : 'http://localhost:3000/api';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResponse(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/z7i?action=ai-doubt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ questionId, aiSolution, doubt, model }),
      });
      const data = await res.json();
      if (data.success && data.response) {
        setResponse(data.response);
      } else {
        setError(data.error || 'Failed to get response.');
      }
    } catch (err) {
      setError('Error connecting to AI doubt service.');
    }
    setLoading(false);
  };

  return (
    <div className="ai-doubt-prompt-panel">
      <form className="ai-doubt-form" onSubmit={handleSubmit}>
        <div className="ai-doubt-form-row">
          <select
            id="ai-doubt-model"
            value={model}
            onChange={e => setModel(e.target.value as 'flash' | 'lite' | '3-12b' | '3-flash')}
            className="ai-doubt-model-select"
            title="AI Model"
          >
            <option value="flash">Flash 2.5</option>
            <option value="3-flash">Gemini 3 Flash</option>
            <option value="3-12b">Gemini 3 12B</option>
            <option value="lite">Flash Lite</option>
          </select>
          <textarea
            value={doubt}
            onChange={e => setDoubt(e.target.value)}
            placeholder="Type your doubt about this solution..."
            rows={2}
            className="ai-doubt-textarea"
            required
            maxLength={300}
            style={{ resize: 'vertical' }}
          />
          <button type="submit" className="ai-doubt-submit-btn" disabled={loading || !doubt.trim()}>
            {loading ? 'Asking...' : 'Ask'}
          </button>
        </div>
      </form>
      {response && (
        <div className="ai-doubt-response-panel">
          <div className="ai-doubt-response-label">AI Response</div>
          <div
            className="ai-doubt-response-html"
            dangerouslySetInnerHTML={{
              __html: renderLatexInHtml(DOMPurify.sanitize(marked.parseInline(response, { async: false })))
            }}
          />
        </div>
      )}
      {error && <div className="ai-doubt-error-msg">{error}</div>}
    </div>
  );
}
