#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { URL } from 'node:url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import pg from 'pg';

const { Pool } = pg;

const BEARER_TOKEN =
  process.env.GETMARKS_AUTH_TOKEN ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2NDZkMmI5YWJlYTJjNDIyYWJmM2Q5YiIsImlhdCI6MTc2OTA4MDI0OCwiZXhwIjoxNzcxNjcyMjQ4fQ.FdaZ6BIpSQz4Qmd6OlUaI1i5Sol6b3HLEFsfQsFZCzI';

if (!BEARER_TOKEN) {
  throw new Error('GETMARKS_AUTH_TOKEN is required');
}

const HEADERS = {
  Authorization: `Bearer ${BEARER_TOKEN}`,
  'Content-Type': 'application/json',
};

const BASE_URLS = {
  dashboard: 'https://web.getmarks.app/api/v3/dashboard/platform/web',
  examSubjects: (examId: string) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}`,
  subjectChapters: (examId: string, subjectId: string) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}/subject/${encodeURIComponent(subjectId)}`,
  chapterQuestions: (examId: string, subjectId: string, chapterId: string) =>
    `https://web.getmarks.app/api/v4/cpyqb/exam/${encodeURIComponent(examId)}/subject/${encodeURIComponent(subjectId)}/chapter/${encodeURIComponent(chapterId)}/questions`,
};

const OUTPUT_DIR = path.resolve(process.cwd(), 'getmarks_data');
const IMAGES_DIR = path.join(OUTPUT_DIR, 'images');
const JSON_DIR = path.join(OUTPUT_DIR, 'json');

const IMAGE_BACKEND = (process.env.IMAGE_BACKEND ?? 'local').toLowerCase();
const OUTPUT_COMPRESSION = (process.env.OUTPUT_COMPRESSION ?? 'none').toLowerCase();
const DATABASE_URL = process.env.DATABASE_URL ?? '';

const EXAM_ID_FILTER = process.env.EXAM_ID ?? '';
const SUBJECT_ID_FILTER = process.env.SUBJECT_ID ?? '';
const CHAPTER_ID_FILTER = process.env.CHAPTER_ID ?? '';
const MAX_CHAPTERS = Number.parseInt(process.env.MAX_CHAPTERS ?? '0', 10);
const MAX_QUESTIONS = Number.parseInt(process.env.MAX_QUESTIONS ?? '0', 10);

const IMAGE_CACHE_CONTROL = 'public, max-age=2592000';

type ProcessedOption = {
  text?: string;
  is_correct?: boolean;
  image?: string;
};

type ProcessedQuestion = {
  index: number;
  type?: string;
  difficulty?: string;
  pyq_info: string;
  question: {
    text?: string;
    image?: string;
  };
  options: ProcessedOption[];
  correct_answer: string[] | string | number | null;
  solution: {
    text?: string;
    image?: string;
  };
};

type ProgressState = {
  totalExams: number;
  totalSubjects: number;
  totalChapters: number;
  totalQuestions: number;
  processedChapters: number;
};

class ProgressTracker {
  state: ProgressState = {
    totalExams: 0,
    totalSubjects: 0,
    totalChapters: 0,
    totalQuestions: 0,
    processedChapters: 0,
  };

  printStatus() {
    console.log(`\n${'='.repeat(60)}`);
    console.log('Progress Summary:');
    console.log(`  Exams: ${this.state.totalExams}`);
    console.log(`  Subjects: ${this.state.totalSubjects}`);
    console.log(`  Chapters: ${this.state.processedChapters}/${this.state.totalChapters}`);
    console.log(`  Questions: ${this.state.totalQuestions}`);
    console.log(`${'='.repeat(60)}\n`);
  }
}

const progress = new ProgressTracker();

function sha1Hash(text: string) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function getFileExtension(url: string, contentType?: string | null) {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const ext = path.extname(pathname);
  if (ext) return ext.toLowerCase();
  if (contentType?.includes('image/png')) return '.png';
  if (contentType?.includes('image/jpeg') || contentType?.includes('image/jpg')) return '.jpg';
  if (contentType?.includes('image/webp')) return '.webp';
  if (contentType?.includes('image/svg')) return '.svg';
  return '.jpg';
}

class ImageStore {
  backend: string;
  s3Client: S3Client | null = null;
  s3Bucket: string | null = null;
  s3Prefix: string;
  s3Region: string | null;

  constructor(backend: string) {
    this.backend = backend;
    this.s3Prefix = process.env.S3_PREFIX ?? 'getmarks';
    this.s3Region = process.env.S3_REGION ?? null;

    if (backend === 's3') {
      const bucket = process.env.S3_BUCKET;
      if (!bucket) {
        throw new Error('S3_BUCKET is required for IMAGE_BACKEND=s3');
      }
      this.s3Bucket = bucket;
      this.s3Client = new S3Client({ region: this.s3Region ?? undefined });
    }
  }

  buildS3Url(key: string) {
    if (!this.s3Bucket) return '';
    if (this.s3Region) {
      return `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${key}`;
    }
    return `s3://${this.s3Bucket}/${key}`;
  }

  async download(url: string, savePath: string) {
    if (!url || url.startsWith('/')) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (this.backend === 'local') {
        await fs.mkdir(path.dirname(savePath), { recursive: true });
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(savePath, buffer);
        return path.relative(OUTPUT_DIR, savePath);
      }

      if (this.backend === 's3') {
        if (!this.s3Client || !this.s3Bucket) {
          throw new Error('S3 client not configured');
        }
        const contentType = response.headers.get('content-type');
        const ext = getFileExtension(url, contentType);
        const stem = path.parse(savePath).name;
        const key = `${this.s3Prefix}/${stem}${ext}`;
        const body = Buffer.from(await response.arrayBuffer());
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.s3Bucket,
            Key: key,
            Body: body,
            ContentType: contentType ?? 'image/jpeg',
            CacheControl: IMAGE_CACHE_CONTROL,
          })
        );
        return this.buildS3Url(key);
      }

      throw new Error(`Unsupported IMAGE_BACKEND: ${this.backend}`);
    } catch (error) {
      console.warn(`  ⚠️  Failed to fetch image ${url}: ${error}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function makeRequest(url: string, params: Record<string, string | number | boolean> = {}) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    target.searchParams.set(key, String(value));
  });
  try {
    const response = await fetch(target, { headers: HEADERS });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(` ❌ Request failed for ${url}: ${error}`);
    return null;
  }
}

async function getJeeExams() {
  console.log('📋 Fetching exam list...');
  const data = await makeRequest(BASE_URLS.dashboard, { limit: 10000 });
  if (!data) return [];
  const items = data?.data?.items ?? [];
  const comp = items.find((item: any) => item?.componentTitle === 'ChapterwiseExams');
  if (!comp) return [];
  const exams = (comp.items ?? [])
    .map((exam: any) => ({
      id: exam?.examId,
      name: exam?.title ?? '',
      icon: exam?.icon ?? {},
    }))
    .filter((exam: any) => {
      if (EXAM_ID_FILTER && exam.id !== EXAM_ID_FILTER) return false;
      return exam.id && (exam.name.toUpperCase().includes('JEE') || exam.name.toUpperCase().includes('IIT'));
    });
  progress.state.totalExams = exams.length;
  console.log(`  ✓ Found ${exams.length} JEE exams`);
  return exams;
}

async function getSubjects(examId: string) {
  const data = await makeRequest(BASE_URLS.examSubjects(examId), { limit: 10000 });
  if (!data) return [];
  const subjects = (data?.data?.subjects ?? []).map((subject: any) => ({
    id: subject?._id,
    name: subject?.title,
    icon: subject?.icon ?? '',
  }));
  return subjects.filter((subject: any) => subject.id && subject.name);
}

async function getChapters(examId: string, subjectId: string) {
  const data = await makeRequest(BASE_URLS.subjectChapters(examId, subjectId), { limit: 10000 });
  if (!data) return [];
  const chapters = (data?.data?.chapters?.data ?? []).map((chapter: any) => ({
    id: chapter?._id,
    name: chapter?.title,
    icon_name: chapter?.icon,
    total_questions: chapter?.allPyqs?.totalQs ?? 0,
  }));
  return chapters.filter((chapter: any) => chapter.id && chapter.name);
}

async function getQuestions(examId: string, subjectId: string, chapterId: string) {
  const data = await makeRequest(BASE_URLS.chapterQuestions(examId, subjectId, chapterId), {
    limit: 10000,
    hideOutOfSyllabus: 'false',
  });
  if (!data) return [];
  return data?.data?.questions ?? [];
}

function buildQuestionPayload(question: any, examId: string, subjectId: string, chapterId: string, idx: number) {
  const imageDir = path.join(IMAGES_DIR, examId, subjectId, chapterId);
  return {
    imageDir,
    payload: {
      index: idx,
      type: question?.type,
      difficulty: question?.level,
      pyq_info: (question?.previousYearPapers ?? [{}])[0]?.title ?? '',
      question: {},
      options: [],
      correct_answer: null,
      solution: {},
    } as ProcessedQuestion,
  };
}

async function processQuestion(question: any, examId: string, subjectId: string, chapterId: string, idx: number, imageStore: ImageStore) {
  const { imageDir, payload } = buildQuestionPayload(question, examId, subjectId, chapterId, idx);
  await fs.mkdir(imageDir, { recursive: true });

  const qData = question?.question ?? {};
  payload.question.text = qData?.text ?? '';
  if (qData?.image) {
    const qImgUrl = qData.image;
    const qImgHash = sha1Hash(qImgUrl);
    const qImgExt = getFileExtension(qImgUrl, null);
    const qImgPath = path.join(imageDir, `q_${String(idx).padStart(4, '0')}_${qImgHash}${qImgExt}`);
    const imageRef = await imageStore.download(qImgUrl, qImgPath);
    if (imageRef) {
      payload.question.image = imageRef;
    }
  }

  const options = question?.options ?? [];
  const correctLetters: string[] = [];
  const letters = ['A', 'B', 'C', 'D'];

  for (const [optIndex, opt] of options.entries()) {
    const optionData: any = {
      text: opt?.text ?? '',
      is_correct: opt?.isCorrect ?? false,
    };
    if (opt?.isCorrect) {
      correctLetters.push(letters[optIndex] ?? String(optIndex + 1));
    }
    if (opt?.image) {
      const optImgUrl = opt.image;
      const optImgHash = sha1Hash(optImgUrl);
      const optImgExt = getFileExtension(optImgUrl, null);
      const optImgPath = path.join(imageDir, `opt${optIndex + 1}_${String(idx).padStart(4, '0')}_${optImgHash}${optImgExt}`);
      const imageRef = await imageStore.download(optImgUrl, optImgPath);
      if (imageRef) {
        optionData.image = imageRef;
      }
    }
    payload.options.push(optionData);
  }

  if (question?.type === 'numerical') {
    payload.correct_answer = question?.correctValue ?? null;
  } else {
    payload.correct_answer = correctLetters;
  }

  const solData = question?.solution ?? {};
  payload.solution.text = solData?.text ?? '';
  if (solData?.image) {
    const solImgUrl = solData.image;
    const solImgHash = sha1Hash(solImgUrl);
    const solImgExt = getFileExtension(solImgUrl, null);
    const solImgPath = path.join(imageDir, `sol_${String(idx).padStart(4, '0')}_${solImgHash}${solImgExt}`);
    const imageRef = await imageStore.download(solImgUrl, solImgPath);
    if (imageRef) {
      payload.solution.image = imageRef;
    }
  }

  return payload;
}

class DatabaseWriter {
  pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async ensureSchema() {
    await this.pool.query(`
      create table if not exists pyq_chapters (
        exam_id text not null,
        subject_id text not null,
        chapter_id text not null,
        exam_name text not null,
        subject_name text not null,
        chapter_name text not null,
        question_count integer not null,
        created_at timestamptz default now(),
        primary key (exam_id, subject_id, chapter_id)
      )
    `);
    await this.pool.query(`
      create table if not exists pyq_questions (
        exam_id text not null,
        subject_id text not null,
        chapter_id text not null,
        question_index integer not null,
        payload jsonb not null,
        created_at timestamptz default now(),
        primary key (exam_id, subject_id, chapter_id, question_index)
      )
    `);
  }

  async insertQuestions(rows: Array<Record<string, any>>) {
    const query = `
      insert into pyq_questions (exam_id, subject_id, chapter_id, question_index, payload)
      values ($1, $2, $3, $4, $5)
      on conflict (exam_id, subject_id, chapter_id, question_index)
      do update set payload = excluded.payload
    `;
    for (const row of rows) {
      await this.pool.query(query, [row.exam_id, row.subject_id, row.chapter_id, row.question_index, row.payload]);
    }
  }

  async upsertChapter(row: Record<string, any>) {
    await this.pool.query(
      `
        insert into pyq_chapters (
          exam_id,
          subject_id,
          chapter_id,
          exam_name,
          subject_name,
          chapter_name,
          question_count
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (exam_id, subject_id, chapter_id)
        do update set question_count = excluded.question_count
      `,
      [
        row.exam_id,
        row.subject_id,
        row.chapter_id,
        row.exam_name,
        row.subject_name,
        row.chapter_name,
        row.question_count,
      ]
    );
  }

  async close() {
    await this.pool.end();
  }
}

function createJsonlWriter(filePath: string) {
  const outputPath = OUTPUT_COMPRESSION === 'gzip' ? `${filePath}.gz` : filePath;
  const writeStream = createWriteStream(outputPath);
  let targetStream: NodeJS.WritableStream = writeStream;
  let gzip: ReturnType<typeof createGzip> | null = null;

  if (OUTPUT_COMPRESSION === 'gzip') {
    gzip = createGzip();
    gzip.pipe(writeStream);
    targetStream = gzip;
  }

  return {
    outputPath,
    write(line: string) {
      targetStream.write(line);
    },
    async close() {
      return new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        if (gzip) {
          gzip.end();
        } else {
          writeStream.end();
        }
      });
    },
  };
}

async function processChapter(exam: any, subject: any, chapter: any, imageStore: ImageStore, dbWriter: DatabaseWriter | null) {
  const examId = exam.id;
  const subjectId = subject.id;
  const chapterId = chapter.id;

  if (SUBJECT_ID_FILTER && subjectId !== SUBJECT_ID_FILTER) return null;
  if (CHAPTER_ID_FILTER && chapterId !== CHAPTER_ID_FILTER) return null;

  console.log(`\n  📖 ${chapter.name} (${chapter.total_questions} questions)`);

  const rawQuestions = await getQuestions(examId, subjectId, chapterId);
  if (!rawQuestions || rawQuestions.length === 0) {
    console.log('    ⚠️  No questions found');
    return null;
  }

  const jsonlPath = path.join(JSON_DIR, `${examId}_${subjectId}_${chapterId}.jsonl`);
  const writer = createJsonlWriter(jsonlPath);

  let questionCount = 0;
  const batchRows: Array<Record<string, any>> = [];

  for (const [idx, question] of rawQuestions.entries()) {
    if (MAX_QUESTIONS && progress.state.totalQuestions >= MAX_QUESTIONS) break;
    try {
      const processed = await processQuestion(question, examId, subjectId, chapterId, idx, imageStore);
      writer.write(`${JSON.stringify(processed)}\n`);
      questionCount += 1;
      progress.state.totalQuestions += 1;

      if (dbWriter) {
        batchRows.push({
          exam_id: examId,
          subject_id: subjectId,
          chapter_id: chapterId,
          question_index: idx,
          payload: processed,
        });
        if (batchRows.length >= 500) {
          await dbWriter.insertQuestions(batchRows);
          batchRows.length = 0;
        }
      }
    } catch (error) {
      console.warn(`    ⚠️  Failed to process question ${idx}: ${error}`);
    }
  }

  if (batchRows.length > 0 && dbWriter) {
    await dbWriter.insertQuestions(batchRows);
  }

  await writer.close();

  const chapterData = {
    exam: exam.name,
    exam_id: examId,
    subject: subject.name,
    subject_id: subjectId,
    chapter: chapter.name,
    chapter_id: chapterId,
    total_questions: questionCount,
    file: path.basename(writer.outputPath),
  };

  if (dbWriter) {
    await dbWriter.upsertChapter({
      exam_id: examId,
      subject_id: subjectId,
      chapter_id: chapterId,
      exam_name: exam.name,
      subject_name: subject.name,
      chapter_name: chapter.name,
      question_count: questionCount,
    });
  }

  console.log(`    ✓ Saved ${questionCount} questions`);
  progress.state.processedChapters += 1;

  return chapterData;
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(' GetMarks JEE Question Scraper');
  console.log(`${'='.repeat(60)}`);

  const startTime = Date.now();

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.mkdir(JSON_DIR, { recursive: true });

  const exams = await getJeeExams();
  if (exams.length === 0) {
    console.log('❌ No JEE exams found!');
    return;
  }

  const allData: Array<Record<string, any>> = [];
  const imageStore = new ImageStore(IMAGE_BACKEND);
  const dbWriter = DATABASE_URL ? new DatabaseWriter(DATABASE_URL) : null;
  if (dbWriter) {
    await dbWriter.ensureSchema();
  }

  for (const exam of exams) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📚 Processing: ${exam.name}`);
    console.log(`${'='.repeat(60)}`);

    let subjects = await getSubjects(exam.id);
    if (SUBJECT_ID_FILTER) {
      subjects = subjects.filter((subject: any) => subject.id === SUBJECT_ID_FILTER);
    }
    progress.state.totalSubjects += subjects.length;
    console.log(`  ✓ Found ${subjects.length} subjects`);

    for (const subject of subjects) {
      console.log(`\n  🔬 Subject: ${subject.name}`);

      let chapters = await getChapters(exam.id, subject.id);
      if (CHAPTER_ID_FILTER) {
        chapters = chapters.filter((chapter: any) => chapter.id === CHAPTER_ID_FILTER);
      }
      progress.state.totalChapters += chapters.length;
      console.log(`    ✓ Found ${chapters.length} chapters`);

      for (const chapter of chapters) {
        if (MAX_CHAPTERS && progress.state.processedChapters >= MAX_CHAPTERS) break;
        const chapterData = await processChapter(exam, subject, chapter, imageStore, dbWriter);
        if (chapterData) {
          allData.push(chapterData);
        }
      }
      if (MAX_CHAPTERS && progress.state.processedChapters >= MAX_CHAPTERS) break;
    }
    if (MAX_CHAPTERS && progress.state.processedChapters >= MAX_CHAPTERS) break;
  }

  const masterIndex = {
    total_exams: progress.state.totalExams,
    total_subjects: progress.state.totalSubjects,
    total_chapters: progress.state.totalChapters,
    total_questions: progress.state.totalQuestions,
    chapters: allData,
  };

  const indexPath = path.join(OUTPUT_DIR, 'master_index.json');
  if (OUTPUT_COMPRESSION === 'gzip') {
    const gzPath = `${indexPath}.gz`;
    const source = Readable.from([Buffer.from(JSON.stringify(masterIndex, null, 2))]);
    const gzip = createGzip();
    await pipeline(source, gzip, createWriteStream(gzPath));
  } else {
    await fs.writeFile(indexPath, JSON.stringify(masterIndex, null, 2));
  }

  const elapsed = (Date.now() - startTime) / 1000;
  progress.printStatus();
  if (dbWriter) {
    await dbWriter.close();
  }
  console.log(`Done in ${elapsed.toFixed(2)}s`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
