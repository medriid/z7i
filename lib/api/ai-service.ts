import { renderRichTextWithLatex } from './latex.js';
import { InferenceClient } from '@huggingface/inference';
import * as fs from 'fs';
import { Buffer } from 'buffer';
export async function generateSolutionsBatch(
  questions: QuestionData[],
  opts?: { model?: ModelKind }
): Promise<Array<GenerateSolutionResult | { error: string; index: number }>> {
  if (!isGeminiConfigured()) {
    throw new Error(
      'AI solution service is not configured. Please set GEMINI_API_KEY environment variable.'
    );
  }

  const apiKeys = getGeminiApiKeys();
  const modelKind: ModelKind = opts?.model === '3-12b' ? '3-12b' : opts?.model === 'lite' ? 'lite' : 'flash';
  const modelName = modelKind === '3-12b' ? 'gemini-3-12b' : modelKind === 'lite' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  let keyIndex = 0;
  let results: Array<GenerateSolutionResult | { error: string; index: number }> = [];
  for (let i = 0; i < questions.length; ++i) {
    let success = false;
    let lastError: any = null;
    for (let tryKey = 0; tryKey < apiKeys.length; ++tryKey) {
      const apiKey = apiKeys[(keyIndex + tryKey) % apiKeys.length];
      try {
        const parts = await buildParts(questions[i]);
        const response = await fetch(`${apiUrl}?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                temperature: 0.5,
                topK: 40,
                topP: 0.9,
                maxOutputTokens: 32000,
              },
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
              ]
            }),
          }
        );
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as GeminiErrorResponse;
          const errorMsg = errorData.error?.message || '';
          if (
            response.status === 429 ||
            /rate.?limit|quota|exceeded|too many/i.test(errorMsg)
          ) {
            lastError = new Error(`Gemini API key #${(keyIndex + tryKey) % apiKeys.length} rate limited: ${errorMsg}`);
            continue; // Try next key
          }
          throw new Error(`Gemini API error (${response.status}): ${errorMsg || 'Unknown error'}`);
        }
        const data = await response.json() as GeminiResponse;
        if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content?.parts?.[0]?.text) {
          throw new Error('Empty solution returned from Gemini API');
        }
        const solutionText = data.candidates[0].content.parts[0].text;
        const aiAnswer = extractFinalAnswer(solutionText);
        const isCorrect = questions[i].isBonus ? true : (aiAnswer ? answersMatch(aiAnswer, questions[i].correctAnswer) : false);
        let cleanedSolution = solutionText.replace(/\[FINAL_ANSWER:[^\]]+\]/gi, '').trim();
        const html = `<div class=\"ai-solution-content\">${renderRichTextWithLatex(cleanedSolution)}</div>`;
        results.push({ html, aiAnswer, isCorrect, modelUsed: modelName });
        keyIndex = (keyIndex + tryKey) % apiKeys.length;
        success = true;
        break;
      } catch (error) {
        lastError = error;
        if (
          !(error instanceof Error) ||
          !/rate.?limit|quota|exceeded|too many/i.test(error.message || '')
        ) {
          break; 
        }
      }
    }
    if (!success) {
      results.push({ error: lastError?.message || 'Unknown error', index: i });
    }
  }
  return results;
}

function getGeminiApiKeys(): string[] {
  const keys: Array<{ index: number; value: string }> = [];
  const envEntries = Object.entries(process.env);

  for (const [name, value] of envEntries) {
    if (!value) continue;
    if (name === 'GEMINI_API_KEY') {
      keys.push({ index: Number.MAX_SAFE_INTEGER, value });
      continue;
    }
    const match = name.match(/^GEMINI_API_KEY_?(\d+)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    if (Number.isFinite(index)) {
      keys.push({ index, value });
    }
  }

  return keys
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.value);
}

export function isGeminiConfigured(): boolean {
  return getGeminiApiKeys().length > 0;
}

const DEFAULT_HF_MODEL = 'black-forest-labs/FLUX.1-schnell';

function getHuggingFaceTokens(): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const token = process.env[`HF_TOKEN${i}`] || process.env[`HF_TOKEN_${i}`];
    if (token) tokens.push(token);
  }
  if (process.env.HF_TOKEN) tokens.push(process.env.HF_TOKEN);
  return tokens;
}

export function isHuggingFaceConfigured(): boolean {
  return getHuggingFaceTokens().length > 0;
}

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function resolveHuggingFaceModel(modelId?: string): string {
  if (!modelId) return DEFAULT_HF_MODEL;
  if (modelId.startsWith('hf:')) {
    const model = modelId.slice(3).trim();
    return model || DEFAULT_HF_MODEL;
  }
  return DEFAULT_HF_MODEL;
}

function resolveImageExtension(contentType: string): string {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/png':
    default:
      return 'png';
  }
}

async function uploadToBlobStorage({
  pathname,
  buffer,
  contentType,
}: {
  pathname: string;
  buffer: Buffer;
  contentType: string;
}): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('Blob storage is not configured. Please set BLOB_READ_WRITE_TOKEN environment variable.');
  }

  const uploadUrl = new URL(`https://blob.vercel-storage.com/${pathname}`);
  uploadUrl.searchParams.set('token', token);
  uploadUrl.searchParams.set('access', 'public');

  const response = await fetch(uploadUrl.toString(), {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: new Uint8Array(buffer),
  });

  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => null);
    const errorMessage = extractErrorMessage(errorPayload) ?? JSON.stringify(errorPayload ?? {});
    throw new Error(`Blob upload failed (${response.status}): ${errorMessage || 'Unknown error'}`);
  }

  const responseType = response.headers.get('content-type') || '';
  if (responseType.includes('application/json')) {
    const payload: unknown = await response.json().catch(() => null);
    const payloadUrl = extractUrl(payload);
    if (payloadUrl) return payloadUrl;
  }

  const headerUrl = response.headers.get('location') || response.headers.get('x-vercel-blob-url');
  if (headerUrl) return headerUrl;

  throw new Error('Blob upload did not return a URL.');
}

type ErrorPayload = {
  error?: string | { message?: unknown };
};

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const error = (payload as ErrorPayload).error;
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return undefined;
}

function extractUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const url = (payload as { url?: unknown }).url;
  return typeof url === 'string' ? url : undefined;
}

function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  );
}

async function normalizeImageResult(result: unknown): Promise<{ buffer: Buffer; contentType: string }> {
  const defaultContentType = 'image/png';

  if (typeof result === 'string') {
    let contentType = defaultContentType;
    let base64Data = result;
    const dataUrlMatch = /^data:(.+?);base64,(.*)$/.exec(result);
    if (dataUrlMatch) {
      contentType = dataUrlMatch[1];
      base64Data = dataUrlMatch[2];
    }
    return { buffer: Buffer.from(base64Data, 'base64'), contentType };
  }

  if (result instanceof ArrayBuffer) {
    return { buffer: Buffer.from(result), contentType: defaultContentType };
  }

  if (isBlobLike(result)) {
    const buffer = Buffer.from(await result.arrayBuffer());
    const contentType = result.type || defaultContentType;
    return { buffer, contentType };
  }

  throw new Error('Unsupported Hugging Face image response.');
}

export async function generateHuggingFaceImage({
  prompt,
  modelId,
}: {
  prompt: string;
  modelId?: string;
}): Promise<{ url: string; modelUsed: string }> {
  const token = process.env.HF_TOKEN0;
  if (!token) {
    throw new Error('Hugging Face service is not configured. Please set HF_TOKEN0 environment variable.');
  }
  if (!isBlobConfigured()) {
    throw new Error('Blob storage is not configured. Please set BLOB_READ_WRITE_TOKEN environment variable.');
  }
  const modelName = resolveHuggingFaceModel(modelId);
  const hf = new InferenceClient(token);
  try {
    const imageBlob = await hf.textToImage({
      provider: 'fal-ai',
      model: modelName,
      inputs: prompt,
      parameters: {
        num_inference_steps: 5,
      },
    });

    const { buffer, contentType } = await normalizeImageResult(imageBlob);
    const extension = resolveImageExtension(contentType);
    const url = await uploadToBlobStorage({
      pathname: `ai-images/${crypto.randomUUID()}.${extension}`,
      buffer,
      contentType,
    });
    return { url, modelUsed: modelName };
  } catch (error) {
    throw new Error('Hugging Face image generation failed: ' + (error instanceof Error ? error.message : String(error)));
  }
}

type HuggingFaceErrorPayload = {
  error?: string | { message?: string };
};

function extractHuggingFaceError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const error = (payload as HuggingFaceErrorPayload).error;
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return undefined;
}

export interface QuestionData {
  questionHtml: string;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  option4?: string | null;
  correctAnswer: string;
  questionType: string;
  subjectName?: string | null;
  isBonus?: boolean;
}

type ModelKind = 'flash' | 'lite' | '3-12b';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface GeminiErrorResponse {
  error?: {
    message?: string;
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPrompt(question: QuestionData): string {
  const isNAT = question.questionType?.toUpperCase().includes('NAT');
  const isMSQ = question.questionType?.toUpperCase() === 'MSQ';
  
  let prompt = `You are an expert JEE tutor. Solve this problem concisely.


`;

  if (!isNAT && (question.option1 || question.option2 || question.option3 || question.option4)) {
    prompt += '**Options:**\n';
    if (question.option1) prompt += `(A) ${stripHtml(question.option1)}\n`;
    if (question.option2) prompt += `(B) ${stripHtml(question.option2)}\n`;
    if (question.option3) prompt += `(C) ${stripHtml(question.option3)}\n`;
    if (question.option4) prompt += `(D) ${stripHtml(question.option4)}\n`;
    prompt += '\n';
  }

  if (question.isBonus) {
    prompt += '**Note:** This is a bonus question. Provide an unbiased solution without relying on any answer key.\n';
  }

  if (!question.isBonus) {
    prompt += `**Correct Answer:** ${question.correctAnswer.toUpperCase()}\n`;
  }

  prompt += `
Provide a CONCISE solution:

- List only the essential formulas/principles (2-3 lines max)
- Each concept on a new line

- Show only the calculation steps
- Each step on a new line
- No lengthy explanations

- Put every equation on its own line
- Use block equations centered and larger: <p class="ai-equation">$$...$$</p>
- Keep narration minimal, equations should be the focus


CRITICAL RULES:
- Maximum 150 words
- Use line breaks between each point
- Format with proper HTML spacing: <p>...</p> and <br> tags
- Use LaTeX: $...$ for inline, $$...$$ for block
- NO verification or lengthy analysis

At the end: [FINAL_ANSWER: ${isNAT ? 'numeric_value' : isMSQ ? 'letter(s)' : 'single_letter'}]`;

  return prompt;
}

function extractFinalAnswer(text: string): string | null {
  const match = text.match(/\[FINAL_ANSWER:\s*([^\]]+)\]/i);
  if (match && match[1]) {
    return match[1].trim().toUpperCase();
  }
  
  const fallbackPatterns = [
    /(?:final|correct)\s+answer\s*(?:is|:)\s*\(?([A-D]+|[\d.+-]+)\)?/i,
    /(?:option|answer)\s+\(?([A-D]+)\)?\s+is\s+correct/i,
    /(?:the\s+)?answer\s*[:=]\s*\(?([A-D]+|[\d.+-]+)\)?/i,
  ];
  
  for (const pattern of fallbackPatterns) {
    const m = text.match(pattern);
    if (m && m[1]) {
      return m[1].trim().toUpperCase();
    }
  }
  
  return null;
}

function normalizeAnswer(answer: string): string {
  let normalized = answer.toUpperCase().replace(/\s+/g, '');
  
  if (/^[A-D]+$/.test(normalized)) {
    normalized = normalized.split('').sort().join('');
  }
  
  return normalized;
}

function answersMatch(aiAnswer: string, correctAnswer: string): boolean {
  const aiNorm = normalizeAnswer(aiAnswer);
  const correctNorm = normalizeAnswer(correctAnswer);
  
  if (aiNorm === correctNorm) return true;
  
  const aiNum = parseFloat(aiAnswer);
  const correctNum = parseFloat(correctAnswer);
  
  if (!isNaN(aiNum) && !isNaN(correctNum)) {
    const tolerance = Math.abs(correctNum) * 0.001 + 0.0001;
    if (Math.abs(aiNum - correctNum) <= tolerance) return true;
  }
  
  return false;
}

function extractImageUrls(html: string | null | undefined): string[] {
  if (!html) return [];
  const urls: string[] = [];
  const imgRegex = /<img[^>]+src=["']([^"'>]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && typeof src === 'string') {
      urls.push(src);
    }
  }
  return urls;
}

async function fetchImageInlineData(url: string): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const mime = resp.headers.get('content-type') || 'image/png';
    const buf = await resp.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    return { inline_data: { mime_type: mime, data: base64 } };
  } catch {
    return null;
  }
}

async function buildParts(question: QuestionData): Promise<Array<Record<string, unknown>>> {
  const parts: Array<Record<string, unknown>> = [{ text: buildPrompt(question) }];

  const imgUrls = [
    ...extractImageUrls(question.questionHtml),
    ...extractImageUrls(question.option1),
    ...extractImageUrls(question.option2),
    ...extractImageUrls(question.option3),
    ...extractImageUrls(question.option4),
  ];

  const uniqueUrls = Array.from(new Set(imgUrls)).slice(0, 4);
  if (uniqueUrls.length > 0) {
    const inlineParts = await Promise.all(uniqueUrls.map(fetchImageInlineData));
    for (const p of inlineParts) {
      if (p) parts.push(p);
    }
  }

  return parts;
}

export interface GenerateSolutionResult {
  html: string;
  aiAnswer: string | null;
  isCorrect: boolean;
  modelUsed: string;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAttachmentInput {
  name?: string;
  type?: string;
  dataUrl?: string;
  url?: string;
}

export type CustomTestGeneratedQuestion = {
  subject?: string;
  chapter?: string;
  difficulty?: string;
  type: string;
  question: string;
  options?: string[];
  answer: string;
  marksPositive?: number;
  marksNegative?: number;
  caseStudyPassage?: string;
  caseStudyGroup?: number;
  diagramPage?: number;
  diagramBounds?: { x: number; y: number; width: number; height: number };
  diagramDataUrl?: string;
  diagramCode?: string;
  diagramSvg?: string;
};

type CustomTestQuestionOutline = {
  subject?: string;
  chapter?: string;
  difficulty?: string;
  type?: string;
  marksPositive?: number;
  marksNegative?: number;
  notes?: string;
  requiresDiagram?: boolean;
};

function shouldPrioritizeDiagram(question: CustomTestGeneratedQuestion): boolean {
  const haystack = `${question.subject || ''} ${question.chapter || ''} ${question.question || ''}`.toLowerCase();
  return /(graph|plot|diagram|figure|circuit|geometry|triangle|parabola|wave|optics|field|bar chart|histogram|coordinate|vector)/i.test(
    haystack
  );
}

function toSvgDataUrl(svg: string): string {
  const encoded = Buffer.from(svg, 'utf8').toString('base64');
  return `data:image/svg+xml;base64,${encoded}`;
}

function extractAnnotatedValue(source: string, symbol: string): string | null {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\s*(?:=|:|is)?\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*([a-zA-ZµΩ^0-9\\/]*)`, 'i');
  const match = source.match(regex);
  if (!match) return null;
  const value = match[1];
  const unit = (match[2] || '').trim();
  return unit ? `${symbol} = ${value} ${unit}` : `${symbol} = ${value}`;
}

function buildHeuristicSvgDiagram(question: CustomTestGeneratedQuestion): string | null {
  const sourceText = `${question.subject || ''} ${question.chapter || ''} ${question.question || ''}`;
  const haystack = sourceText.toLowerCase();

  if (/(triangle|geometry|angle|perpendicular|tangent)/i.test(haystack)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="white"/><polygon points="120,340 520,340 280,100" fill="none" stroke="#111827" stroke-width="4"/><line x1="280" y1="100" x2="280" y2="340" stroke="#6b7280" stroke-dasharray="8 8" stroke-width="3"/><text x="110" y="365" font-size="24" fill="#111827">A</text><text x="525" y="365" font-size="24" fill="#111827">B</text><text x="275" y="92" font-size="24" fill="#111827">C</text></svg>`;
    return toSvgDataUrl(svg);
  }

  if (/(circuit|resistor|battery|voltage|current)/i.test(haystack)) {
    const resistorLabel = extractAnnotatedValue(sourceText, 'R1') || extractAnnotatedValue(sourceText, 'R') || 'R = ? Ω';
    const voltageLabel = extractAnnotatedValue(sourceText, 'V') || extractAnnotatedValue(sourceText, 'E') || 'V = ? V';
    const currentLabel = extractAnnotatedValue(sourceText, 'I') || 'I';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300"><rect width="640" height="300" fill="white"/><line x1="80" y1="150" x2="210" y2="150" stroke="#111827" stroke-width="4"/><polyline points="210,150 225,130 245,170 265,130 285,170 305,130 325,170 345,150" fill="none" stroke="#111827" stroke-width="4"/><line x1="345" y1="150" x2="430" y2="150" stroke="#111827" stroke-width="4"/><line x1="430" y1="115" x2="430" y2="185" stroke="#111827" stroke-width="4"/><line x1="450" y1="105" x2="450" y2="195" stroke="#111827" stroke-width="8"/><line x1="450" y1="150" x2="560" y2="150" stroke="#111827" stroke-width="4"/><line x1="80" y1="150" x2="80" y2="240" stroke="#111827" stroke-width="4"/><line x1="80" y1="240" x2="560" y2="240" stroke="#111827" stroke-width="4"/><line x1="560" y1="240" x2="560" y2="150" stroke="#111827" stroke-width="4"/><text x="228" y="118" font-size="20" fill="#111827">${resistorLabel}</text><text x="397" y="92" font-size="18" fill="#111827">−</text><text x="454" y="92" font-size="18" fill="#111827">+</text><text x="462" y="134" font-size="18" fill="#111827">${voltageLabel}</text><text x="300" y="205" font-size="18" fill="#111827">${currentLabel} →</text></svg>`;
    return toSvgDataUrl(svg);
  }

  if (/(wave|sin|cos|oscillation|optics)/i.test(haystack)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="360" viewBox="0 0 680 360"><rect width="680" height="360" fill="white"/><line x1="60" y1="300" x2="640" y2="300" stroke="#111827" stroke-width="3"/><line x1="80" y1="40" x2="80" y2="320" stroke="#111827" stroke-width="3"/><path d="M80,190 C120,90 180,90 220,190 C260,290 320,290 360,190 C400,90 460,90 500,190 C540,290 600,290 640,190" fill="none" stroke="#2563eb" stroke-width="5"/><text x="648" y="312" font-size="18" fill="#111827">x</text><text x="65" y="35" font-size="18" fill="#111827">y</text></svg>`;
    return toSvgDataUrl(svg);
  }

  if (/(bar chart|histogram|frequency|distribution)/i.test(haystack)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="380" viewBox="0 0 660 380"><rect width="660" height="380" fill="white"/><line x1="70" y1="310" x2="620" y2="310" stroke="#111827" stroke-width="3"/><line x1="90" y1="50" x2="90" y2="330" stroke="#111827" stroke-width="3"/><rect x="140" y="220" width="70" height="90" fill="#60a5fa"/><rect x="240" y="170" width="70" height="140" fill="#3b82f6"/><rect x="340" y="130" width="70" height="180" fill="#2563eb"/><rect x="440" y="190" width="70" height="120" fill="#1d4ed8"/><text x="275" y="355" font-size="18" fill="#111827">Bins</text><text x="15" y="45" font-size="18" fill="#111827">f</text></svg>`;
    return toSvgDataUrl(svg);
  }

  if (/(graph|plot|coordinate|parabola|line|vector|field)/i.test(haystack)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="420" viewBox="0 0 680 420"><rect width="680" height="420" fill="white"/><line x1="60" y1="340" x2="640" y2="340" stroke="#111827" stroke-width="3"/><line x1="120" y1="40" x2="120" y2="380" stroke="#111827" stroke-width="3"/><path d="M120,320 C190,240 260,180 330,140 C400,100 470,95 540,110" fill="none" stroke="#16a34a" stroke-width="5"/><line x1="120" y1="340" x2="520" y2="120" stroke="#dc2626" stroke-width="4" stroke-dasharray="10 8"/><text x="645" y="350" font-size="18" fill="#111827">x</text><text x="105" y="35" font-size="18" fill="#111827">y</text></svg>`;
    return toSvgDataUrl(svg);
  }

  return null;
}

function normalizeSvgMarkup(svgText: string): string {
  let svg = String(svgText || '').trim();
  if (!svg) return '';

  const fenceMatch = svg.match(/^```(?:svg|xml)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) {
    svg = fenceMatch[1].trim();
  }

  const start = svg.indexOf('<svg');
  const end = svg.lastIndexOf('</svg>');
  if (start >= 0 && end > start) {
    svg = svg.slice(start, end + '</svg>'.length);
  }

  return svg.trim();
}

async function generateFallbackDiagramSvg(question: CustomTestGeneratedQuestion): Promise<string> {
  const prompt = `Write only raw SVG markup (no markdown fences, no explanation) for this JEE question diagram.
Question: ${question.question}
Subject: ${question.subject || 'General'}
Chapter: ${question.chapter || 'General'}
Rules:
- output a single complete <svg>...</svg> document
- create a clear 2D figure with white background and readable labels
- include all relevant symbols and given numerical values directly on the diagram (e.g., R1 = 2Ω, v = 10 m/s, theta = 30°)
- add axis names/units or node labels where applicable
- if the question has a graph/table style setup, plot representative data points and annotate key values
- keep line thickness and font sizes exam-readable
- include arrowheads/markers/ticks where appropriate for scientific accuracy.`;
  const text = await callGemini({
    modelName: 'gemini-2.5-flash-lite',
    systemPrompt: 'You output only accurate, detailed SVG markup.',
    userPrompt: prompt,
    maxOutputTokens: 2400,
    temperature: 0.1,
  });
  return normalizeSvgMarkup(text);
}

async function createDiagramDataUrl(question: CustomTestGeneratedQuestion): Promise<{ imageDataUrl: string | null; source: 'svg-llm' | 'svg-heuristic' | 'none' }> {
  let diagramSvg = normalizeSvgMarkup(question.diagramSvg || question.diagramCode || '');
  if (!diagramSvg) {
    try {
      diagramSvg = await generateFallbackDiagramSvg(question);
      question.diagramSvg = diagramSvg;
    } catch {
      diagramSvg = '';
    }
  }

  if (diagramSvg.startsWith('<svg') && diagramSvg.includes('</svg>')) {
    return { imageDataUrl: toSvgDataUrl(diagramSvg), source: 'svg-llm' };
  }

  const heuristicSvg = buildHeuristicSvgDiagram(question);
  if (heuristicSvg) {
    return { imageDataUrl: heuristicSvg, source: 'svg-heuristic' };
  }

  return { imageDataUrl: null, source: 'none' };
}

type ChatContentPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export type CustomTestGenerationLog = {
  timestamp: string;
  message: string;
};

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function buildChatAttachmentParts(
  attachments: ChatAttachmentInput[]
): Promise<Array<{ inline_data: { mime_type: string; data: string } }>> {
  const parts: Array<{ inline_data: { mime_type: string; data: string } }> = [];
  for (const attachment of attachments.slice(0, 4)) {
    if (attachment.dataUrl) {
      const parsed = parseDataUrl(attachment.dataUrl);
      if (parsed) {
        parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.data } });
      }
      continue;
    }

    if (attachment.url) {
      const inlineData = await fetchImageInlineData(attachment.url);
      if (inlineData) {
        parts.push(inlineData);
      }
    }
  }

  return parts;
}

function resolveChatModel(modelId?: string): string {
  if (modelId && modelId.startsWith('gemini-')) {
    return modelId;
  }
  return 'gemini-2.5-flash';
}

function resolveCustomTestModel(modelId: string): string {
  if (modelId === '3-12b') return 'gemini-3-12b';
  if (modelId === '3-flash') return 'gemini-3-flash-preview';
  if (modelId === '2.5-flash') return 'gemini-2.5-flash';
  if (modelId === 'lite') return 'gemini-2.5-flash-lite';
  return 'gemini-2.5-flash';
}

function extractJsonCandidates(text: string): string[] {
  const candidates = new Set<string>();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const block = fenced[1].trim();
    if (block) candidates.add(block);
  }

  const trimmed = text.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    candidates.add(trimmed);
  }

  const blocks = extractBalancedJsonBlocks(text);
  for (const block of blocks) {
    candidates.add(block);
  }

  return Array.from(candidates);
}

function extractBalancedJsonBlocks(text: string): string[] {
  const results: string[] = [];
  const stack: string[] = [];
  let startIndex: number | null = null;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{' || char === '[') {
      if (stack.length === 0) {
        startIndex = i;
      }
      stack.push(char);
      continue;
    }

    if (char === '}' || char === ']') {
      if (stack.length === 0) continue;
      const last = stack[stack.length - 1];
      const isMatch = (char === '}' && last === '{') || (char === ']' && last === '[');
      if (!isMatch) continue;
      stack.pop();
      if (stack.length === 0 && startIndex !== null) {
        const block = text.slice(startIndex, i + 1).trim();
        if (block) results.push(block);
        startIndex = null;
      }
    }
  }

  return results;
}

export async function generateChatResponse({
  messages,
  systemPrompt,
  modelId,
  attachments,
}: {
  messages: ChatMessageInput[];
  systemPrompt?: string;
  modelId?: string;
  attachments?: ChatAttachmentInput[];
}): Promise<{ text: string; modelUsed: string }> {
  if (!isGeminiConfigured()) {
    throw new Error(
      'AI solution service is not configured. Please set GEMINI_API_KEY environment variable.'
    );
  }

  const apiKeys = getGeminiApiKeys();
  const modelName = resolveChatModel(modelId);
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const contents: Array<{ role: 'user' | 'model'; parts: ChatContentPart[] }> = messages
    .filter(message => message.content.trim())
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  if (attachments && attachments.length > 0) {
    const attachmentParts = await buildChatAttachmentParts(attachments);
    if (attachmentParts.length > 0) {
      let targetIndex = -1;
      for (let i = contents.length - 1; i >= 0; i -= 1) {
        if (contents[i].role === 'user') {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) {
        contents.push({ role: 'user', parts: [] });
        targetIndex = contents.length - 1;
      }

      contents[targetIndex].parts.push(...attachmentParts);
    }
  }

  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.4,
      topK: 40,
      topP: 0.9,
      maxOutputTokens: 32000,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  if (systemPrompt?.trim()) {
    requestBody.systemInstruction = {
      parts: [{ text: systemPrompt.trim() }],
    };
  }

  let lastError: unknown;
  for (let i = 0; i < apiKeys.length; ++i) {
    const apiKey = apiKeys[i];
    try {
      const response = await fetch(`${apiUrl}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as GeminiErrorResponse;
        const errorMsg = errorData.error?.message || '';
        if (response.status === 429 || /rate.?limit|quota|exceeded|too many/i.test(errorMsg)) {
          lastError = new Error(`Gemini API key #${i} rate limited: ${errorMsg}`);
          continue;
        }
        throw new Error(`Gemini API error (${response.status}): ${errorMsg || 'Unknown error'}`);
      }

      const data = (await response.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) {
        throw new Error('Empty response returned from Gemini API');
      }
      return { text, modelUsed: modelName };
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof Error) ||
        !/rate.?limit|quota|exceeded|too many/i.test(error.message || '')
      ) {
        throw error;
      }
    }
  }

  throw lastError || new Error('All Gemini API keys failed or rate limited.');
}

export async function extractQuestionsFromPdf({
  pdfBase64,
  modelId,
}: {
  pdfBase64: string;
  modelId?: string;
}): Promise<{ questions: CustomTestGeneratedQuestion[]; logs: CustomTestGenerationLog[]; hasSubjective: boolean }> {
  if (!isGeminiConfigured()) {
    throw new Error('AI solution service is not configured. Please set GEMINI_API_KEY environment variable.');
  }

  const logs: CustomTestGenerationLog[] = [];
  const addLog = (message: string) => {
    logs.push({ timestamp: new Date().toISOString(), message });
  };

  const apiKeys = getGeminiApiKeys();
  const modelName = modelId ? resolveCustomTestModel(modelId) : 'gemini-2.5-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  addLog(`Sending PDF to ${modelName} for question extraction.`);

  const systemPrompt = `
You are an expert exam paper parser. You will be given a PDF of an exam/test paper.
Extract ALL questions from it. For each question, determine:
1. The question number (as it appears in the paper)
2. The full question text (preserve mathematical notation using LaTeX where appropriate)
3. The question type: one of "MCQ", "MAQ", "NAT", or "SUBJECTIVE"
   - MCQ = Multiple Choice Question (single correct answer from options)
   - MAQ = Multiple Answer Question (multiple correct answers from options)
   - NAT = Numerical Answer Type (answer is a number)
   - SUBJECTIVE = Long answer / descriptive / proof / derivation type
4. For MCQ/MAQ: extract all options exactly as they appear
5. For MCQ: identify the correct answer if marked in the paper (use "A","B","C","D" etc). If not determinable, use empty string.
6. For MAQ: identify correct answers as comma-separated like "A,B" or "A,C,D". If not determinable, use empty string.
7. For NAT: identify the correct numerical answer if available. If not determinable, use empty string.
8. For SUBJECTIVE: set answer to empty string.

CASE STUDY / COMPREHENSION QUESTIONS:
If the paper has case study, comprehension, or passage-based questions (where a shared paragraph/passage is followed by multiple sub-questions like 1.1, 1.2, etc.), you MUST:
- Assign all sub-questions that share the same passage the same "caseStudyGroup" number (an integer starting from 1 for the first group, 2 for the second, etc.).
- Include the full passage text in the "caseStudyPassage" field for EVERY sub-question in that group.
- Each sub-question is still its own separate question object in the array.
- Questions that are NOT part of any case study should have caseStudyGroup set to 0 and caseStudyPassage set to "".

IMAGES AND DIAGRAMS:
If a question references a diagram, figure, graph, circuit, table, or any visual image in the PDF:
- You MUST report its location so we can clip it from the PDF. Set:
  - "diagramPage": the 1-based page number where the diagram appears
  - "diagramBounds": { "x": <left edge %>, "y": <top edge %>, "width": <width %>, "height": <height %> }
    All values are percentages (0-100) of the page dimensions.
    For example, a diagram in the top-right quarter of page 2: { "x": 50, "y": 0, "width": 50, "height": 50 }
- Be as precise as possible with the bounding box. Include a small margin (2-3%) around the diagram.
- If no diagram exists for a question, set diagramPage to 0 and omit diagramBounds.
- Also briefly describe the diagram in the question text for accessibility, e.g. "[Figure: circuit with R1, R2 in series]"

Return ONLY valid JSON without markdown fencing. Output format:
{
  "questions": [
    {
      "questionNumber": 1,
      "question": "Question text here (use LaTeX like \\\\(x^2\\\\) for math)",
      "type": "MCQ",
      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
      "answer": "A",
      "subject": "Physics",
      "chapter": "",
      "marksPositive": 4,
      "marksNegative": 1,
      "caseStudyGroup": 0,
      "caseStudyPassage": "",
      "diagramPage": 0
    },
    {
      "questionNumber": 2,
      "question": "[Figure: circuit diagram with R1, R2 in series] Find the equivalent resistance...",
      "type": "MCQ",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": "B",
      "subject": "Physics",
      "chapter": "",
      "marksPositive": 4,
      "marksNegative": 1,
      "caseStudyGroup": 0,
      "caseStudyPassage": "",
      "diagramPage": 1,
      "diagramBounds": { "x": 55, "y": 20, "width": 40, "height": 30 }
    },
    {
      "questionNumber": 3,
      "question": "Find the value of x...",
      "type": "NAT",
      "answer": "42",
      "subject": "Mathematics",
      "chapter": "",
      "marksPositive": 4,
      "marksNegative": 0,
      "caseStudyGroup": 0,
      "caseStudyPassage": "",
      "diagramPage": 0
    }
  ]
}

Rules:
- For MCQ/MAQ questions, always include exactly the options from the paper.
- For NAT questions, omit the options array.
- For SUBJECTIVE questions, omit the options array, set marksPositive and marksNegative to 0.
- If marks per question are stated in the paper, use those values.
- If marks are not stated, use +4/-1 for MCQ, +4/0 for NAT, 0/0 for SUBJECTIVE.
- Try to identify the subject from context. If unclear, use "General".
- Preserve all mathematical expressions using LaTeX notation.
- ALWAYS wrap Greek letters, special symbols, and scientific notation in LaTeX delimiters. Examples:
  - Use \\(\\Omega\\) not Ω, \\(\\rho\\) not ρ, \\(\\mu\\) not μ, \\(\\alpha\\) not α
  - Use \\(\\times\\) not ×, \\(\\div\\) not ÷, \\(\\pm\\) not ±, \\(\\leq\\) not ≤
  - Use \\(\\degree\\text{C}\\) or \\(^\\circ\\text{C}\\) not °C
  Never output bare Unicode math symbols outside LaTeX delimiters.
- Do NOT add random line breaks within a sentence. Keep each sentence on one continuous line.
- Use \\n\\n (double newline) ONLY to separate distinct paragraphs or the "[Figure: ...]" block from surrounding text.
`;

  const requestBody = {
    contents: [{
      role: 'user',
      parts: [
        { text: 'Extract all questions from this exam paper PDF.' },
        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
      ],
    }],
    systemInstruction: {
      parts: [{ text: systemPrompt.trim() }],
    },
    generationConfig: {
      temperature: 0.2,
      topK: 40,
      topP: 0.9,
      maxOutputTokens: 320000,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  let lastError: unknown;
  for (let i = 0; i < apiKeys.length; ++i) {
    const apiKey = apiKeys[i];
    try {
      const response = await fetch(`${apiUrl}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as GeminiErrorResponse;
        const errorMsg = errorData.error?.message || '';
        if (response.status === 429 || /rate.?limit|quota|exceeded|too many/i.test(errorMsg)) {
          lastError = new Error(`Gemini API key #${i} rate limited: ${errorMsg}`);
          continue;
        }
        throw new Error(`Gemini API error (${response.status}): ${errorMsg || 'Unknown error'}`);
      }

      const data = (await response.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) {
        throw new Error('Empty response returned from Gemini API');
      }

      addLog('Received response from AI. Parsing questions...');

      // Parse JSON from response
      const candidates = extractJsonCandidates(text);
      let parsed: { questions: Array<{
        questionNumber?: number;
        question: string;
        type: string;
        options?: string[];
        answer: string;
        subject?: string;
        chapter?: string;
        marksPositive?: number;
        marksNegative?: number;
        caseStudyGroup?: number;
        caseStudyPassage?: string;
        diagramPage?: number;
        diagramBounds?: { x: number; y: number; width: number; height: number };
      }> } | null = null;

      for (const candidate of candidates) {
        const sanitized = candidate.replace(/,\s*([}\]])/g, '$1');
        try {
          parsed = JSON.parse(sanitized);
          break;
        } catch {
          continue;
        }
      }

      if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        throw new Error('Failed to extract questions from PDF. The AI response was not valid JSON or contained no questions.');
      }

      let hasSubjective = false;
      const questions: CustomTestGeneratedQuestion[] = parsed.questions.map((q, idx) => {
        const normalizedType = (q.type || '').toUpperCase();
        let type: string;
        if (normalizedType.includes('MAQ') || normalizedType.includes('MULTIPLE ANSWER')) {
          type = 'MAQ';
        } else if (normalizedType.includes('MCQ') || normalizedType.includes('SINGLE')) {
          type = 'MCQ';
        } else if (normalizedType.includes('NAT') || normalizedType.includes('NUMERICAL') || normalizedType.includes('INTEGER')) {
          type = 'NAT';
        } else {
          type = 'SUBJECTIVE';
        }

        if (type === 'SUBJECTIVE') {
          hasSubjective = true;
        }

        const result: CustomTestGeneratedQuestion = {
          subject: q.subject || 'General',
          chapter: q.chapter || undefined,
          difficulty: undefined,
          type,
          question: q.question,
          answer: q.answer || '',
          marksPositive: type === 'SUBJECTIVE' ? 0 : (q.marksPositive ?? 4),
          marksNegative: type === 'SUBJECTIVE' ? 0 : (q.marksNegative ?? (type === 'NAT' ? 0 : 1)),
        };

        if (q.caseStudyGroup && q.caseStudyGroup > 0 && q.caseStudyPassage) {
          result.caseStudyGroup = q.caseStudyGroup;
          result.caseStudyPassage = q.caseStudyPassage;
        }

        if (q.diagramPage && q.diagramPage > 0 && q.diagramBounds) {
          result.diagramPage = q.diagramPage;
          result.diagramBounds = {
            x: Math.max(0, Math.min(100, q.diagramBounds.x ?? 0)),
            y: Math.max(0, Math.min(100, q.diagramBounds.y ?? 0)),
            width: Math.max(1, Math.min(100, q.diagramBounds.width ?? 50)),
            height: Math.max(1, Math.min(100, q.diagramBounds.height ?? 50)),
          };
        }

        if ((type === 'MCQ' || type === 'MAQ') && Array.isArray(q.options)) {
          result.options = q.options.slice(0, 4);
        }

        return result;
      });

      addLog(`Extracted ${questions.length} questions (${hasSubjective ? 'includes subjective — marks will not be counted' : 'all gradable'}).`);

      return { questions, logs, hasSubjective };
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof Error) ||
        !/rate.?limit|quota|exceeded|too many/i.test(error.message || '')
      ) {
        throw error;
      }
    }
  }

  throw lastError || new Error('All Gemini API keys failed or rate limited.');
}

export async function generateCustomTestQuestions({
  prompt,
  modelId,
}: {
  prompt: string;
  modelId: string;
}): Promise<{ questions: CustomTestGeneratedQuestion[]; logs: CustomTestGenerationLog[] }> {
  if (!isGeminiConfigured()) {
    throw new Error(
      'AI solution service is not configured. Please set GEMINI_API_KEY environment variable.'
    );
  }

  const logs: CustomTestGenerationLog[] = [];
  const addLog = (message: string) => {
    logs.push({ timestamp: new Date().toISOString(), message });
  };

  const apiKeys = getGeminiApiKeys();
  const modelPreference = modelId === 'auto' ? 'auto' : resolveCustomTestModel(modelId);
  const ALL_CUSTOM_TEST_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3-12b'];
  const RATE_LIMIT_REGEX = /rate.?limit|quota|exceeded|too many/i;
  const resolveDifficulty = (value?: string) => {
    if (!value) return 'medium';
    const normalized = value.toLowerCase();
    if (normalized.includes('hard')) return 'hard';
    if (normalized.includes('easy')) return 'easy';
    return 'medium';
  };
  const resolveQuestionType = (value?: string) => {
    if (!value) return 'MCQ';
    return value.toUpperCase().includes('NAT') ? 'NAT' : 'MCQ';
  };
  const buildModelFallbackChain = (primaryModel: string) => (
    [primaryModel, ...ALL_CUSTOM_TEST_MODELS.filter(model => model !== primaryModel)]
  );
  const resolveQuestionModels = (difficulty?: string) => {
    if (modelPreference !== 'auto') return buildModelFallbackChain(modelPreference);
    const primaryModel = resolveDifficulty(difficulty) === 'hard' ? 'gemini-3-flash-preview' : 'gemini-2.5-flash';
    return buildModelFallbackChain(primaryModel);
  };
  const isRateLimitError = (error: unknown) => {
    if (!(error instanceof Error)) return false;
    return RATE_LIMIT_REGEX.test(error.message || '');
  };

  const callGemini = async ({
    modelCandidates,
    systemPrompt,
    userPrompt,
    maxOutputTokens,
    temperature,
    contextLabel,
  }: {
    modelCandidates: string[];
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
    temperature: number;
    contextLabel: string;
  }): Promise<string> => {
    const requestBody = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: {
        parts: [{ text: systemPrompt.trim() }],
      },
      generationConfig: {
        temperature,
        topK: 40,
        topP: 0.9,
        maxOutputTokens,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    let lastError: unknown;
    for (const modelName of modelCandidates) {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
      for (let i = 0; i < apiKeys.length; ++i) {
        const apiKey = apiKeys[i];
        try {
          addLog(`${contextLabel}: trying ${modelName} with API key #${i + 1}.`);
          const response = await fetch(`${apiUrl}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorData = (await response.json().catch(() => ({}))) as GeminiErrorResponse;
            const errorMsg = errorData.error?.message || '';
            if (response.status === 429 || RATE_LIMIT_REGEX.test(errorMsg)) {
              lastError = new Error(`Gemini API key #${i + 1} rate limited on ${modelName}: ${errorMsg}`);
              addLog(`${contextLabel}: ${modelName} key #${i + 1} rate limited, rotating.`);
              continue;
            }
            throw new Error(`Gemini API error (${response.status}) on ${modelName}: ${errorMsg || 'Unknown error'}`);
          }

          const data = (await response.json()) as GeminiResponse;
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (!text) {
            throw new Error('Empty response returned from Gemini API');
          }
          addLog(`${contextLabel}: response received from ${modelName} (key #${i + 1}).`);
          return text;
        } catch (error) {
          lastError = error;
          if (!isRateLimitError(error)) {
            throw error;
          }
        }
      }
      addLog(`${contextLabel}: exhausted keys for ${modelName}, trying fallback model.`);
    }

    throw lastError || new Error('All Gemini API keys failed or rate limited.');
  };

  const repairPotentiallyInvalidJson = (input: string): string => {
    const withoutTrailingCommas = input.replace(/,\s*([}\]])/g, '$1');
    const escapedBackslashes = withoutTrailingCommas.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
    return Array.from(escapedBackslashes)
      .filter(char => {
        const code = char.charCodeAt(0);
        return code >= 32 || char === '\n' || char === '\r' || char === '\t';
      })
      .join('');
  };

  const parseJsonPayload = <T>(text: string, errorMessage: string): T => {
    const candidates = extractJsonCandidates(text);
    if (candidates.length === 0) {
      throw new Error(`${errorMessage}: Unable to locate JSON in AI response.`);
    }

    const errors: string[] = [];
    for (const candidate of candidates) {
      const variants = [candidate, repairPotentiallyInvalidJson(candidate)];
      for (const sanitized of variants) {
        try {
          return JSON.parse(sanitized) as T;
        } catch (error) {
          errors.push((error as Error).message);
        }
      }
    }

    throw new Error(`${errorMessage}: ${errors[0] || 'Unable to parse JSON.'}`);
  };

  const mapWithConcurrency = async <T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
  ): Promise<R[]> => {
    if (items.length === 0) return [];
    const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array<R>(items.length);
    let cursor = 0;

    const workers = Array.from({ length: normalizedConcurrency }, async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= items.length) return;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    });

    await Promise.all(workers);
    return results;
  };

  const generateOutline = async () => {
    const outlinePrimaryModel = modelPreference === 'auto' ? 'gemini-2.5-flash-lite' : modelPreference;
    const outlineModels = buildModelFallbackChain(outlinePrimaryModel);
    addLog(`Planning question blueprint with fallback chain: ${outlineModels.join(' -> ')}.`);
    const systemPrompt = `
You are an expert test planner for JEE-style exams.
Return ONLY valid JSON without markdown.
Output format:
{
  "questions": [
    {
      "subject": "Physics",
      "chapter": "Kinematics",
      "difficulty": "easy|medium|hard",
      "type": "MCQ" or "NAT",
      "marksPositive": 4,
      "marksNegative": 1,
      "notes": "Short intent of the question"
    }
  ]
}
Rules:
- Keep notes under 20 words.
- Match the user's requested mix of subjects, chapters, difficulty, and types.
- Ensure the difficulty is JEE Main 2026 standard: easy = still tricky conceptual, medium = exam-level multi-step, hard = high-end + mixed concepts.
`;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const text = await callGemini({
          modelCandidates: outlineModels,
          systemPrompt,
          userPrompt: `User prompt:\n${prompt}`,
          maxOutputTokens: 32000,
          temperature: 0.3,
          contextLabel: 'Outline',
        });
        const parsed = parseJsonPayload<{ questions: CustomTestQuestionOutline[] }>(
          text,
          'Outline response was not valid JSON'
        );
        if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
          throw new Error('Outline did not include any questions.');
        }
        const questions = parsed.questions;
        const targetWithDiagram = Math.ceil((questions.length * 2) / 3);
        const prioritized = questions
          .map((item, idx) => ({ item, idx, priority: shouldPrioritizeDiagram({ type: item.type || 'MCQ', question: item.notes || '', subject: item.subject, chapter: item.chapter, answer: '' }) ? 1 : 0 }))
          .sort((a, b) => b.priority - a.priority || a.idx - b.idx);
        const required = new Set(prioritized.slice(0, targetWithDiagram).map(entry => entry.idx));
        const withFlags = questions.map((item, idx) => ({ ...item, requiresDiagram: required.has(idx) }));
        addLog(`Outline ready with ${withFlags.length} questions (${targetWithDiagram} targeted for diagrams).`);
        return withFlags;
      } catch (error) {
        lastError = error as Error;
        addLog('Retrying outline generation due to JSON formatting issue.');
      }
    }
    throw lastError || new Error('Failed to generate outline.');
  };

  const generateQuestion = async (outline: CustomTestQuestionOutline, index: number) => {
    const difficulty = resolveDifficulty(outline.difficulty);
    const questionType = resolveQuestionType(outline.type);
    const modelCandidates = resolveQuestionModels(difficulty);
    addLog(
      `Generating Q${index + 1} (${outline.subject || 'General'} | ${outline.chapter || 'Mixed'} | ${difficulty}) with ${modelCandidates.join(' -> ')}.`
    );
    const systemPrompt = `
You are an expert JEE question writer.
Return ONLY valid JSON without markdown.
Output format:
{
  "subject": "Physics",
  "chapter": "Kinematics",
  "difficulty": "easy|medium|hard",
  "type": "MCQ" or "NAT",
  "question": "Question text in HTML-safe plain text",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "answer": "A/B/C/D or numeric value as string",
  "marksPositive": 4,
  "marksNegative": 1,
  "diagramSvg": "Detailed SVG markup"
}
Rules:
- If type is NAT, omit options.
- If type is MCQ, include exactly 4 options.
- Ensure answer matches the type.
- Return exactly one question JSON object (no additional questions).
- Keep HTML minimal (use <br/> for line breaks if needed).
- Escape any quotes inside strings.
- Difficulty calibration must be JEE 2026 competitive level: deeper reasoning, tighter distractors, and less direct substitutions.
- easy = conceptually tricky + one non-obvious step; medium = multi-step with cross-topic linkage; hard = advanced, time-pressure style, often with edge-case traps.
- Avoid boilerplate textbook questions. Use realistic constraints, units, and near-miss options.
- For requiresDiagram=true, include diagramSvg as a complete and valid <svg>...</svg> snippet that draws the exact needed figure.
- In diagramSvg, annotate all given quantities/labels directly in the figure (e.g., R1=2Ω, q=+3µC, v0, theta, lengths, angles).
- If graph-based, include plotted points/markers/ticks/grid cues that reflect the data in the question.
- Ensure the drawing is accurate and detailed enough to solve the question.
- For requiresDiagram=false, omit diagramSvg.
`;
    const userPrompt = `
Create a single question using these constraints:
Subject: ${outline.subject || 'Mixed'}
Chapter: ${outline.chapter || 'Mixed'}
Difficulty: ${difficulty}
Type: ${questionType}
Marks: +${outline.marksPositive ?? 4}, -${outline.marksNegative ?? 1}
Notes: ${outline.notes || 'Follow the user prompt intent.'}
Requires diagram: ${outline.requiresDiagram ? 'true' : 'false'}

User prompt:
${prompt}
`;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const text = await callGemini({
          modelCandidates,
          systemPrompt,
          userPrompt,
          maxOutputTokens: 320000,
          temperature: 0.35,
          contextLabel: `Q${index + 1}`,
        });
        const parsed = parseJsonPayload<CustomTestGeneratedQuestion>(
          text,
          'Question response was not valid JSON'
        );
        parsed.type = resolveQuestionType(parsed.type || questionType);
        parsed.difficulty = resolveDifficulty(parsed.difficulty || difficulty);
        parsed.subject = parsed.subject || outline.subject;
        parsed.chapter = parsed.chapter || outline.chapter;
        parsed.marksPositive = parsed.marksPositive ?? outline.marksPositive ?? 4;
        parsed.marksNegative = parsed.marksNegative ?? outline.marksNegative ?? 1;
        parsed.answer = String(parsed.answer ?? '').trim();
        if (!parsed.answer) {
          parsed.answer = parsed.type === 'NAT' ? '0' : 'A';
        }
        if (parsed.type === 'MCQ') {
          parsed.options = (parsed.options || []).slice(0, 4);
        } else {
          delete parsed.options;
        }
        addLog(
          `Completed Q${index + 1}: ${parsed.subject || outline.subject || 'General'} / ${parsed.chapter || outline.chapter || 'Mixed'} / ${parsed.type}.`
        );
        return parsed;
      } catch (error) {
        lastError = error as Error;
        addLog(`Retrying Q${index + 1} due to ${lastError.message || 'unknown error'}.`);
      }
    }
    throw lastError || new Error('Failed to generate question.');
  };

  addLog(`Starting custom test generation (model preference: ${modelId}).`);
  const outline = await generateOutline();
  const questionConcurrency = Math.min(8, Math.max(2, Math.ceil(outline.length / 10)));
  addLog(`Generating ${outline.length} questions in parallel (concurrency: ${questionConcurrency}).`);
  const questions = await mapWithConcurrency(outline, questionConcurrency, (item, index) => generateQuestion(item, index));

  const targetWithDiagram = Math.ceil((questions.length * 2) / 3);
  if (targetWithDiagram > 0) {
    const diagramConcurrency = Math.min(4, targetWithDiagram);
    addLog(
      `Rendering SVG diagrams for ${targetWithDiagram} of ${questions.length} questions (concurrency: ${diagramConcurrency}).`
    );
    const prioritized = questions
      .map((question, index) => ({ question, index, priority: (question.diagramSvg || question.diagramCode)?.trim() ? 2 : shouldPrioritizeDiagram(question) ? 1 : 0 }))
      .sort((a, b) => b.priority - a.priority || a.index - b.index)
      .slice(0, targetWithDiagram);

    const attachedResults = await mapWithConcurrency(prioritized, diagramConcurrency, async entry => {
      const result = await createDiagramDataUrl(entry.question);
      if (!result.imageDataUrl) return { attached: 0, source: 'none' as const };
      entry.question.diagramDataUrl = result.imageDataUrl;
      const imageTag = `<img src="${result.imageDataUrl}" alt="Question diagram" style="display:block;max-width:100%;height:auto;margin:0.6rem auto;background:#ffffff;padding:0.35rem;border:1px solid #e5e7eb;border-radius:0.4rem;" />`;
      entry.question.question = `${entry.question.question}<div style="margin-top:0.45rem;">${imageTag}</div>`;
      return { attached: 1, source: result.source };
    });
    const attached = attachedResults.reduce((sum, value) => sum + Number(value.attached), 0);
    const svgLlmCount = attachedResults.filter(value => value.source === 'svg-llm').length;
    const heuristicCount = attachedResults.filter(value => value.source === 'svg-heuristic').length;
    addLog(`Attached ${attached} diagram(s): ${svgLlmCount} model-generated SVG, ${heuristicCount} SVG fallback.`);
  }
  addLog('All questions generated.');
  return { questions, logs };
}


export async function generateSolution(
  question: QuestionData,
  opts?: { model?: ModelKind }
): Promise<GenerateSolutionResult> {
  if (!isGeminiConfigured()) {
    throw new Error(
      'AI solution service is not configured. Please set GEMINI_API_KEY environment variable.'
    );
  }

  const apiKeys = getGeminiApiKeys();
  const modelKind: ModelKind = opts?.model === '3-12b' ? '3-12b' : opts?.model === 'lite' ? 'lite' : 'flash';
  const modelName = modelKind === '3-12b' ? 'gemini-3-12b' : modelKind === 'lite' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  let lastError: any = null;
  for (let i = 0; i < apiKeys.length; ++i) {
    const apiKey = apiKeys[i];
    try {
      console.log(`[AI Solutions] Generating solution using ${modelName} (key #${i})`);
      const parts = await buildParts(question);
      const response = await fetch(`${apiUrl}?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.5,
              topK: 40,
              topP: 0.9,
              maxOutputTokens: 320000,
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as GeminiErrorResponse;
        const errorMsg = errorData.error?.message || '';
        console.error('[AI Solutions] Gemini API error:', {
          status: response.status,
          error: errorData,
        });
        if (
          response.status === 429 ||
          /rate.?limit|quota|exceeded|too many/i.test(errorMsg)
        ) {
          lastError = new Error(`Gemini API key #${i} rate limited: ${errorMsg}`);
          continue; // Try next key
        }
        throw new Error(`Gemini API error (${response.status}): ${errorMsg || 'Unknown error'}`);
      }

      const data = await response.json() as GeminiResponse;
      if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content?.parts?.[0]?.text) {
        throw new Error('Empty solution returned from Gemini API');
      }
      const solutionText = data.candidates[0].content.parts[0].text;
      console.log(`[AI Solutions] Solution generated successfully via ${modelName} (key #${i})`);
      const aiAnswer = extractFinalAnswer(solutionText);
      const isCorrect = question.isBonus ? true : (aiAnswer ? answersMatch(aiAnswer, question.correctAnswer) : false);
      const validationSummary = question.isBonus
        ? 'BONUS_QUESTION_SKIP'
        : `${aiAnswer ? `AI="${aiAnswer}"` : 'AI=NONE'} vs Correct="${question.correctAnswer}"`;
      console.log(`[AI Solutions] Answer validation: ${validationSummary} => ${isCorrect ? 'MATCH' : 'MISMATCH'}`);
      let cleanedSolution = solutionText.replace(/\[FINAL_ANSWER:[^\]]+\]/gi, '').trim();
      const html = `<div class="ai-solution-content">${renderRichTextWithLatex(cleanedSolution)}</div>`;
      return {
        html,
        aiAnswer,
        isCorrect,
        modelUsed: modelName
      };
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof Error) ||
        !/rate.?limit|quota|exceeded|too many/i.test(error.message || '')
      ) {
        console.error('[AI Solutions] Error calling Gemini API:', error);
        throw error;
      }
    }
  }
  console.error('[AI Solutions] All Gemini API keys failed or rate limited.');
  throw lastError || new Error('All Gemini API keys failed or rate limited.');
}

  export async function generateDoubtResponse(
    question: QuestionData,
    aiSolution: string,
    doubt: string,
    opts?: { model?: ModelKind }
  ): Promise<string> {
    if (!isGeminiConfigured()) {
      throw new Error(
        'AI solution service is not configured. Please set GEMINI_API_KEY environment variable.'
      );
    }

    const apiKeys = getGeminiApiKeys();
    const modelKind: ModelKind = opts?.model === '3-12b' ? '3-12b' : opts?.model === 'lite' ? 'lite' : 'flash';
    const modelName = modelKind === '3-12b' ? 'gemini-3-12b' : modelKind === 'lite' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    const prompt = `You are an expert JEE tutor. Here is a question and its AI-generated solution. A student has a doubt about the solution. Please answer the doubt clearly and concisely.\n\nQuestion: ${stripHtml(question.questionHtml)}\n\nAI Solution: ${stripHtml(aiSolution)}\n\nStudent's Doubt: ${doubt}\n\nYour response:`;

    let lastError: any = null;
    for (let i = 0; i < apiKeys.length; ++i) {
      const apiKey = apiKeys[i];
      try {
        const response = await fetch(`${apiUrl}?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.5,
              topK: 40,
              topP: 0.9,
              maxOutputTokens: 320000,
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
          }),
        });
        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as GeminiErrorResponse;
          const errorMsg = errorData.error?.message || '';
          if (
            response.status === 429 ||
            /rate.?limit|quota|exceeded|too many/i.test(errorMsg)
          ) {
            lastError = new Error(`Gemini API key #${i} rate limited: ${errorMsg}`);
            continue;
          }
          throw new Error(`Gemini API error (${response.status}): ${errorMsg || 'Unknown error'}`);
        }
        const data = (await response.json()) as GeminiResponse;
        if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content?.parts?.[0]?.text) {
          throw new Error('Empty response returned from Gemini API');
        }
        const text = data.candidates[0].content.parts[0].text.trim();
        const html = `<div class=\"ai-doubt-response-content\">${renderRichTextWithLatex(text)}</div>`;
        return html;
      } catch (error) {
        lastError = error;
        if (
          !(error instanceof Error) ||
          !/rate.?limit|quota|exceeded|too many/i.test(error.message || '')
        ) {
          throw error;
        }
      }
    }
    throw lastError || new Error('All Gemini API keys failed or rate limited.');
  }
