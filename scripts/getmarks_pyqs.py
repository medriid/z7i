#!/usr/bin/env python3
import gzip
import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from urllib.parse import urlparse

import requests

BEARER_TOKEN = os.getenv(
    "GETMARKS_AUTH_TOKEN",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2NDZkMmI5YWJlYTJjNDIyYWJmM2Q5YiIsImlhdCI6MTc2OTA4MDI0OCwiZXhwIjoxNzcxNjcyMjQ4fQ.FdaZ6BIpSQz4Qmd6OlUaI1i5Sol6b3HLEFsfQsFZCzI",
)
if not BEARER_TOKEN:
    raise SystemExit("GETMARKS_AUTH_TOKEN is required")

HEADERS = {"Authorization": f"Bearer {BEARER_TOKEN}", "Content-Type": "application/json"}

BASE_URLS = {
    "dashboard": "https://web.getmarks.app/api/v3/dashboard/platform/web",
    "exam_subjects": "https://web.getmarks.app/api/v4/cpyqb/exam/{}",
    "subject_chapters": "https://web.getmarks.app/api/v4/cpyqb/exam/{}/subject/{}",
    "chapter_questions": "https://web.getmarks.app/api/v4/cpyqb/exam/{}/subject/{}/chapter/{}/questions",
}

OUTPUT_DIR = Path("getmarks_data")
IMAGES_DIR = OUTPUT_DIR / "images"
JSON_DIR = OUTPUT_DIR / "json"

OUTPUT_DIR.mkdir(exist_ok=True)
IMAGES_DIR.mkdir(exist_ok=True)
JSON_DIR.mkdir(exist_ok=True)

IMAGE_BACKEND = os.getenv("IMAGE_BACKEND", "local").lower()
OUTPUT_COMPRESSION = os.getenv("OUTPUT_COMPRESSION", "none").lower()
DATABASE_URL = os.getenv("DATABASE_URL")

EXAM_ID_FILTER = os.getenv("EXAM_ID")
SUBJECT_ID_FILTER = os.getenv("SUBJECT_ID")
CHAPTER_ID_FILTER = os.getenv("CHAPTER_ID")
MAX_CHAPTERS = int(os.getenv("MAX_CHAPTERS", "0"))
MAX_QUESTIONS = int(os.getenv("MAX_QUESTIONS", "0"))


@dataclass
class ProgressTracker:
    total_exams: int = 0
    total_subjects: int = 0
    total_chapters: int = 0
    total_questions: int = 0
    processed_chapters: int = 0

    def print_status(self) -> None:
        print(f"\n{'=' * 60}")
        print("Progress Summary:")
        print(f"  Exams: {self.total_exams}")
        print(f"  Subjects: {self.total_subjects}")
        print(f"  Chapters: {self.processed_chapters}/{self.total_chapters}")
        print(f"  Questions: {self.total_questions}")
        print(f"{'=' * 60}\n")


progress = ProgressTracker()


def sha1_hash(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()


def get_file_extension(url: str, content_type: Optional[str] = None) -> str:
    path = urlparse(url).path
    _, ext = os.path.splitext(path)
    if ext:
        return ext.lower()

    if content_type:
        if "image/png" in content_type:
            return ".png"
        if "image/jpeg" in content_type or "image/jpg" in content_type:
            return ".jpg"
        if "image/webp" in content_type:
            return ".webp"
        if "image/svg" in content_type:
            return ".svg"

    return ".jpg"


class ImageStore:
    def __init__(self, backend: str) -> None:
        self.backend = backend
        self.s3_client = None
        self.s3_bucket = None
        self.s3_prefix = None
        self.s3_region = None

        if backend == "s3":
            try:
                import boto3
            except ImportError as exc:
                raise SystemExit("boto3 is required for IMAGE_BACKEND=s3") from exc

            self.s3_bucket = os.getenv("S3_BUCKET")
            self.s3_prefix = os.getenv("S3_PREFIX", "getmarks")
            self.s3_region = os.getenv("S3_REGION")
            if not self.s3_bucket:
                raise SystemExit("S3_BUCKET is required for IMAGE_BACKEND=s3")

            self.s3_client = boto3.client("s3")

    def _build_s3_url(self, key: str) -> str:
        if self.s3_region:
            return f"https://{self.s3_bucket}.s3.{self.s3_region}.amazonaws.com/{key}"
        return f"s3://{self.s3_bucket}/{key}"

    def download(self, url: str, save_path: Path) -> Optional[str]:
        if not url or url.startswith("/"):
            return None

        try:
            response = requests.get(url, timeout=30, stream=True)
            response.raise_for_status()

            if self.backend == "local":
                save_path.parent.mkdir(parents=True, exist_ok=True)
                with open(save_path, "wb") as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                return str(save_path.relative_to(OUTPUT_DIR))

            if self.backend == "s3":
                ext = get_file_extension(url, response.headers.get("Content-Type"))
                key = f"{self.s3_prefix}/{save_path.stem}{ext}"
                self.s3_client.upload_fileobj(response.raw, self.s3_bucket, key)
                return self._build_s3_url(key)

            raise ValueError(f"Unsupported IMAGE_BACKEND: {self.backend}")
        except Exception as e:
            print(f"  ⚠️  Failed to fetch image {url}: {e}")
            return None


def make_request(url: str, params: Optional[Dict] = None) -> Optional[Dict]:
    try:
        response = requests.get(url, headers=HEADERS, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f" ❌ Request failed for {url}: {e}")
        return None


def get_jee_exams() -> List[Dict]:
    print("📋 Fetching exam list...")
    data = make_request(BASE_URLS["dashboard"], params={"limit": 10000})

    if not data:
        return []

    items = data.get("data", {}).get("items", [])
    comp = next((i for i in items if i.get("componentTitle") == "ChapterwiseExams"), None)

    if not comp:
        return []

    exams = []
    for ex in comp.get("items", []):
        exam_id = ex.get("examId")
        title = ex.get("title", "")

        if EXAM_ID_FILTER and exam_id != EXAM_ID_FILTER:
            continue

        if exam_id and ("JEE" in title.upper() or "IIT" in title.upper()):
            exams.append({"id": exam_id, "name": title, "icon": ex.get("icon", {})})

    progress.total_exams = len(exams)
    print(f"  ✓ Found {len(exams)} JEE exams")
    return exams


def get_subjects(exam_id: str) -> List[Dict]:
    url = BASE_URLS["exam_subjects"].format(exam_id)
    data = make_request(url, params={"limit": 10000})

    if not data:
        return []

    subjects = []
    for s in data.get("data", {}).get("subjects", []) or []:
        subjects.append({"id": s.get("_id"), "name": s.get("title"), "icon": s.get("icon", "")})

    return [s for s in subjects if s.get("id") and s.get("name")]


def get_chapters(exam_id: str, subject_id: str) -> List[Dict]:
    url = BASE_URLS["subject_chapters"].format(exam_id, subject_id)
    data = make_request(url, params={"limit": 10000})

    if not data:
        return []

    chapters = []
    chapters_data = data.get("data", {}).get("chapters", {}).get("data", [])

    for c in chapters_data:
        chapters.append(
            {
                "id": c.get("_id"),
                "name": c.get("title"),
                "icon_name": c.get("icon"),
                "total_questions": c.get("allPyqs", {}).get("totalQs", 0),
            }
        )

    return [c for c in chapters if c.get("id") and c.get("name")]


def get_questions(exam_id: str, subject_id: str, chapter_id: str) -> List[Dict]:
    url = BASE_URLS["chapter_questions"].format(exam_id, subject_id, chapter_id)
    data = make_request(url, params={"limit": 10000, "hideOutOfSyllabus": "false"})

    if not data:
        return []

    return data.get("data", {}).get("questions", []) or []


def process_question(
    question: Dict,
    exam_id: str,
    subject_id: str,
    chapter_id: str,
    idx: int,
    image_store: ImageStore,
) -> Dict:
    img_dir = IMAGES_DIR / exam_id / subject_id / chapter_id
    img_dir.mkdir(parents=True, exist_ok=True)

    processed = {
        "index": idx,
        "type": question.get("type"),
        "difficulty": question.get("level"),
        "pyq_info": (question.get("previousYearPapers") or [{}])[0].get("title", ""),
        "question": {},
        "options": [],
        "correct_answer": None,
        "solution": {},
    }

    q_data = question.get("question") or {}
    processed["question"]["text"] = q_data.get("text", "")

    if q_data.get("image"):
        q_img_url = q_data["image"]
        q_img_hash = sha1_hash(q_img_url)
        q_img_ext = get_file_extension(q_img_url)
        q_img_path = img_dir / f"q_{idx:04d}_{q_img_hash}{q_img_ext}"
        image_ref = image_store.download(q_img_url, q_img_path)
        if image_ref:
            processed["question"]["image"] = image_ref

    options = question.get("options") or []
    correct_letters = []
    letters = ["A", "B", "C", "D"]

    for i, opt in enumerate(options):
        opt_data = {"text": opt.get("text", ""), "is_correct": opt.get("isCorrect", False)}

        if opt.get("isCorrect"):
            correct_letters.append(letters[i] if i < len(letters) else str(i + 1))

        if opt.get("image"):
            opt_img_url = opt["image"]
            opt_img_hash = sha1_hash(opt_img_url)
            opt_img_ext = get_file_extension(opt_img_url)
            opt_img_path = img_dir / f"opt{i + 1}_{idx:04d}_{opt_img_hash}{opt_img_ext}"
            image_ref = image_store.download(opt_img_url, opt_img_path)
            if image_ref:
                opt_data["image"] = image_ref

        processed["options"].append(opt_data)

    if question.get("type") == "numerical":
        processed["correct_answer"] = question.get("correctValue")
    else:
        processed["correct_answer"] = correct_letters

    sol_data = question.get("solution") or {}
    processed["solution"]["text"] = sol_data.get("text", "")

    if sol_data.get("image"):
        sol_img_url = sol_data["image"]
        sol_img_hash = sha1_hash(sol_img_url)
        sol_img_ext = get_file_extension(sol_img_url)
        sol_img_path = img_dir / f"sol_{idx:04d}_{sol_img_hash}{sol_img_ext}"
        image_ref = image_store.download(sol_img_url, sol_img_path)
        if image_ref:
            processed["solution"]["image"] = image_ref

    return processed


class DatabaseWriter:
    def __init__(self, database_url: str) -> None:
        try:
            import psycopg
        except ImportError as exc:
            raise SystemExit("psycopg is required when DATABASE_URL is set") from exc

        self.conn = psycopg.connect(database_url, autocommit=True)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
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
                """
            )
            cur.execute(
                """
                create table if not exists pyq_questions (
                    exam_id text not null,
                    subject_id text not null,
                    chapter_id text not null,
                    question_index integer not null,
                    payload jsonb not null,
                    created_at timestamptz default now(),
                    primary key (exam_id, subject_id, chapter_id, question_index)
                )
                """
            )

    def insert_questions(self, rows: Iterable[Dict]) -> None:
        with self.conn.cursor() as cur:
            cur.executemany(
                """
                insert into pyq_questions (exam_id, subject_id, chapter_id, question_index, payload)
                values (%(exam_id)s, %(subject_id)s, %(chapter_id)s, %(question_index)s, %(payload)s)
                on conflict (exam_id, subject_id, chapter_id, question_index)
                do update set payload = excluded.payload
                """,
                rows,
            )

    def upsert_chapter(self, chapter_row: Dict) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into pyq_chapters (
                    exam_id,
                    subject_id,
                    chapter_id,
                    exam_name,
                    subject_name,
                    chapter_name,
                    question_count
                )
                values (
                    %(exam_id)s,
                    %(subject_id)s,
                    %(chapter_id)s,
                    %(exam_name)s,
                    %(subject_name)s,
                    %(chapter_name)s,
                    %(question_count)s
                )
                on conflict (exam_id, subject_id, chapter_id)
                do update set question_count = excluded.question_count
                """,
                chapter_row,
            )

    def close(self) -> None:
        self.conn.close()


def _open_jsonl_writer(path: Path):
    if OUTPUT_COMPRESSION == "gzip":
        return gzip.open(path.with_suffix(path.suffix + ".gz"), "wt", encoding="utf-8")
    return open(path, "w", encoding="utf-8")


def process_chapter(
    exam: Dict,
    subject: Dict,
    chapter: Dict,
    image_store: ImageStore,
    db_writer: Optional[DatabaseWriter],
) -> Optional[Dict]:
    exam_id = exam["id"]
    subject_id = subject["id"]
    chapter_id = chapter["id"]

    if SUBJECT_ID_FILTER and subject_id != SUBJECT_ID_FILTER:
        return None
    if CHAPTER_ID_FILTER and chapter_id != CHAPTER_ID_FILTER:
        return None

    print(f"\n  📖 {chapter['name']} ({chapter['total_questions']} questions)")

    raw_questions = get_questions(exam_id, subject_id, chapter_id)

    if not raw_questions:
        print("    ⚠️  No questions found")
        return None

    jsonl_path = JSON_DIR / f"{exam_id}_{subject_id}_{chapter_id}.jsonl"
    question_count = 0
    batch_rows = []

    with _open_jsonl_writer(jsonl_path) as writer:
        for idx, q in enumerate(raw_questions):
            if MAX_QUESTIONS and progress.total_questions >= MAX_QUESTIONS:
                break
            try:
                processed = process_question(q, exam_id, subject_id, chapter_id, idx, image_store)
                writer.write(json.dumps(processed, ensure_ascii=False) + "\n")
                question_count += 1
                progress.total_questions += 1

                if db_writer:
                    batch_rows.append(
                        {
                            "exam_id": exam_id,
                            "subject_id": subject_id,
                            "chapter_id": chapter_id,
                            "question_index": idx,
                            "payload": processed,
                        }
                    )
                    if len(batch_rows) >= 500:
                        db_writer.insert_questions(batch_rows)
                        batch_rows.clear()
            except Exception as e:
                print(f"    ⚠️  Failed to process question {idx}: {e}")
    if batch_rows and db_writer:
        db_writer.insert_questions(batch_rows)

    chapter_data = {
        "exam": exam["name"],
        "exam_id": exam_id,
        "subject": subject["name"],
        "subject_id": subject_id,
        "chapter": chapter["name"],
        "chapter_id": chapter_id,
        "total_questions": question_count,
        "file": jsonl_path.name + (".gz" if OUTPUT_COMPRESSION == "gzip" else ""),
    }

    if db_writer:
        db_writer.upsert_chapter(
            {
                "exam_id": exam_id,
                "subject_id": subject_id,
                "chapter_id": chapter_id,
                "exam_name": exam["name"],
                "subject_name": subject["name"],
                "chapter_name": chapter["name"],
                "question_count": question_count,
            }
        )

    print(f"    ✓ Saved {question_count} questions")
    progress.processed_chapters += 1

    return chapter_data


def main() -> None:
    print("\n" + "=" * 60)
    print(" GetMarks JEE Question Scraper")
    print("=" * 60)

    start_time = time.time()

    exams = get_jee_exams()
    if not exams:
        print("❌ No JEE exams found!")
        return

    all_data = []
    image_store = ImageStore(IMAGE_BACKEND)
    db_writer = DatabaseWriter(DATABASE_URL) if DATABASE_URL else None

    for exam in exams:
        print(f"\n{'=' * 60}")
        print(f"📚 Processing: {exam['name']}")
        print(f"{'=' * 60}")

        subjects = get_subjects(exam["id"])
        if SUBJECT_ID_FILTER:
            subjects = [s for s in subjects if s.get("id") == SUBJECT_ID_FILTER]
        progress.total_subjects += len(subjects)
        print(f"  ✓ Found {len(subjects)} subjects")

        for subject in subjects:
            print(f"\n  🔬 Subject: {subject['name']}")

            chapters = get_chapters(exam["id"], subject["id"])
            if CHAPTER_ID_FILTER:
                chapters = [c for c in chapters if c.get("id") == CHAPTER_ID_FILTER]
            progress.total_chapters += len(chapters)
            print(f"    ✓ Found {len(chapters)} chapters")

            for chapter in chapters:
                if MAX_CHAPTERS and progress.processed_chapters >= MAX_CHAPTERS:
                    break
                chapter_data = process_chapter(exam, subject, chapter, image_store, db_writer)
                if chapter_data:
                    all_data.append(chapter_data)
            if MAX_CHAPTERS and progress.processed_chapters >= MAX_CHAPTERS:
                break
        if MAX_CHAPTERS and progress.processed_chapters >= MAX_CHAPTERS:
            break

    master_index = {
        "total_exams": progress.total_exams,
        "total_subjects": progress.total_subjects,
        "total_chapters": progress.total_chapters,
        "total_questions": progress.total_questions,
        "chapters": all_data,
    }

    index_path = OUTPUT_DIR / "master_index.json"
    if OUTPUT_COMPRESSION == "gzip":
        index_path = index_path.with_suffix(index_path.suffix + ".gz")
        with gzip.open(index_path, "wt", encoding="utf-8") as f:
            json.dump(master_index, f, indent=2, ensure_ascii=False)
    else:
        with open(index_path, "w", encoding="utf-8") as f:
            json.dump(master_index, f, indent=2, ensure_ascii=False)

    elapsed = time.time() - start_time
    progress.print_status()
    if db_writer:
        db_writer.close()
    print(f"Done in {elapsed:.2f}s")


if __name__ == "__main__":
    main()
