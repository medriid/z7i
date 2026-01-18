import { renderLatexInHtml } from './latex.js';
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
                maxOutputTokens: 8000,
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
        const html = `<div class=\"ai-solution-content\">${cleanedSolution}</div>`;
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
  const keys: string[] = [];
  for (let i = 0; i < 5; ++i) {
    const key = process.env[`GEMINI_API_KEY${i}`] || process.env[`GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  return keys;
}

export function isGeminiConfigured(): boolean {
  return getGeminiApiKeys().length > 0;
}

const DEFAULT_HF_MODEL = 'imagepipeline/flux_uncensored_nsfw_v2';

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
    body: buffer,
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
};

type CustomTestQuestionOutline = {
  subject?: string;
  chapter?: string;
  difficulty?: string;
  type?: string;
  marksPositive?: number;
  marksNegative?: number;
  notes?: string;
};

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
  if (modelId === 'lite') return 'gemini-2.5-flash-lite';
  return 'gemini-2.5-flash';
}

function extractJsonBlock(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  throw new Error('Unable to parse AI response.');
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

  const contents = messages
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
      maxOutputTokens: 8192,
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
  const resolveQuestionModel = (difficulty?: string) =>
    resolveDifficulty(difficulty) === 'hard' ? 'gemini-3-flash' : 'gemini-2.5-flash';

  const callGemini = async ({
    modelName,
    systemPrompt,
    userPrompt,
    maxOutputTokens,
    temperature,
  }: {
    modelName: string;
    systemPrompt: string;
    userPrompt: string;
    maxOutputTokens: number;
    temperature: number;
  }): Promise<string> => {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
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
        return text;
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
  };

  const parseJsonPayload = <T>(text: string, errorMessage: string): T => {
    const jsonText = extractJsonBlock(text);
    try {
      return JSON.parse(jsonText) as T;
    } catch (error) {
      throw new Error(`${errorMessage}: ${(error as Error).message}`);
    }
  };

  const generateOutline = async () => {
    addLog('Planning question blueprint with Gemini 2.5 Flash Lite.');
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
`;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const text = await callGemini({
          modelName: 'gemini-2.5-flash-lite',
          systemPrompt,
          userPrompt: `User prompt:\n${prompt}`,
          maxOutputTokens: 2500,
          temperature: 0.3,
        });
        const parsed = parseJsonPayload<{ questions: CustomTestQuestionOutline[] }>(
          text,
          'Outline response was not valid JSON'
        );
        if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
          throw new Error('Outline did not include any questions.');
        }
        addLog(`Outline ready with ${parsed.questions.length} questions.`);
        return parsed.questions;
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
    const modelName = resolveQuestionModel(difficulty);
    addLog(
      `Generating Q${index + 1} (${outline.subject || 'General'} | ${outline.chapter || 'Mixed'} | ${difficulty}) with ${modelName}.`
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
  "marksNegative": 1
}
Rules:
- If type is NAT, omit options.
- If type is MCQ, include exactly 4 options.
- Ensure answer matches the type.
- Keep HTML minimal (use <br/> for line breaks if needed).
- Escape any quotes inside strings.
`;
    const userPrompt = `
Create a single question using these constraints:
Subject: ${outline.subject || 'Mixed'}
Chapter: ${outline.chapter || 'Mixed'}
Difficulty: ${difficulty}
Type: ${questionType}
Marks: +${outline.marksPositive ?? 4}, -${outline.marksNegative ?? 1}
Notes: ${outline.notes || 'Follow the user prompt intent.'}

User prompt:
${prompt}
`;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const text = await callGemini({
          modelName,
          systemPrompt,
          userPrompt,
          maxOutputTokens: 1500,
          temperature: 0.35,
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
        if (parsed.type === 'MCQ') {
          parsed.options = (parsed.options || []).slice(0, 4);
        } else {
          delete parsed.options;
        }
        return parsed;
      } catch (error) {
        lastError = error as Error;
        addLog(`Retrying Q${index + 1} due to JSON formatting issue.`);
      }
    }
    throw lastError || new Error('Failed to generate question.');
  };

  addLog(`Starting custom test generation (model preference: ${modelId}).`);
  const outline = await generateOutline();
  const questions: CustomTestGeneratedQuestion[] = [];
  for (let i = 0; i < outline.length; i += 1) {
    const question = await generateQuestion(outline[i], i);
    questions.push(question);
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
              maxOutputTokens: 8000,
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
      const html = `<div class="ai-solution-content">${cleanedSolution}</div>`;
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
              maxOutputTokens: 4000,
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
        const html = `<div class=\"ai-doubt-response-content\">${renderLatexInHtml(text)}</div>`;
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
