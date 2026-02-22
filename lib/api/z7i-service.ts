export async function z7iGetFirstName(cookies: string[]): Promise<string | null> {
  const response = await fetch(`${BASE_URL}/student/settings`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
      'Cookie': cookies.join('; '),
      'Referer': `${BASE_URL}/student/`,
    },
  });
  const html = await response.text();
  const match = html.match(/ng-init=\"pf\.firstname='([^']+)'\"/);
  if (match) {
    return match[1];
  }
  return null;
}
const BASE_URL = "https://test.z7i.in";

interface Z7iCookies {
  cookies: string[];
}

interface Z7iLoginResponse {
  status: boolean;
  msg: string;
  rdr: string | null;
}

interface Z7iPackage {
  _id: { $oid: string };
  name: string;
  description: string;
  expiry_date?: number;
  test_series: Array<{ $oid: string }>;
}

interface Z7iTest {
  _id: { $oid: string };
  test_name: string;
  description?: string;
  test_type?: string;
  time_limit?: string;
  max_score?: number;
  subjects?: Array<{
    subject: { $oid: string };
    subject_name: string;
    no_of_question: string;
  }>;
  start_date?: string;
  end_date?: string;
  questions?: Array<{
    qid: { $oid: string };
    subject_id: { $oid: string };
  }>;
}

interface Z7iScoreOverview {
  _id: { $oid: string };
  test_id: { $oid: string };
  time_taken: number;
  submit_date: number;
  attempted: number;
  correct: number;
  incorrect: number;
  total_score: number;
  max_score?: number;
  rank?: number;
  percentile?: number;
  bonus_marks?: number;
  test: Array<{
    test_name: string;
    test_type: string;
    time_limit: string;
    total_qs: string;
    max_score: number;
  }>;
}

interface Z7iQuestion {
  _id: { $oid: string };
  subject: { $oid: string };
  question_type: string;
  question: string;
  opt1?: string;
  opt2?: string;
  opt3?: string;
  opt4?: string;
  ans: string;
  marks_positive: string;
  marks_negative: string;
  __order: number;
  std_ans?: string;
  ans_status: string;
  p_score: number;
  n_score: number;
  time_taken?: number;
  find_hint?: string;
}

function extractSetCookies(response: Response): string[] {
  const cookies: string[] = [];
  const setCookieHeader = response.headers.get('set-cookie');
  if (setCookieHeader) {
    const cookieParts = setCookieHeader.split(/,(?=\s*\w+=)/);
    for (const part of cookieParts) {
      const cookie = part.split(';')[0].trim();
      if (cookie) cookies.push(cookie);
    }
  }
  return cookies;
}

export async function z7iLogin(username: string, password: string): Promise<Z7iCookies | null> {
  const sessionCookies: string[] = [];
  
  const initialResponse = await fetch(BASE_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
    redirect: 'manual',
  });
  sessionCookies.push(...extractSetCookies(initialResponse));
  
  const loginResponse = await fetch(`${BASE_URL}/student/auth/login`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Cookie': sessionCookies.join('; '),
      'Referer': BASE_URL,
      'Origin': BASE_URL,
    },
    body: JSON.stringify({ username, password }),
    redirect: 'manual',
  });
  
  sessionCookies.push(...extractSetCookies(loginResponse));
  
  try {
    const data = await loginResponse.json() as Z7iLoginResponse;
    if (data.status === true) {
      return { cookies: sessionCookies };
    }
  } catch {
  }
  
  return null;
}

export async function z7iGetPackages(cookies: string[]): Promise<Z7iPackage[]> {
  const response = await fetch(`${BASE_URL}/student/tests/get-mypackage/`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Cookie': cookies.join('; '),
      'Referer': `${BASE_URL}/student/`,
    },
  });
  
  const text = await response.text();
  const data = JSON.parse(text) as { status: boolean; package: Z7iPackage[] };
  
  if (data.status) {
    return data.package;
  }
  return [];
}

export async function z7iGetPackageDetails(cookies: string[], packageId: string): Promise<{ tests: Z7iTest[] } | null> {
  const response = await fetch(`${BASE_URL}/student/tests/get-mypackage-details/${packageId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Cookie': cookies.join('; '),
      'Referer': `${BASE_URL}/student/`,
    },
  });

  if (!response.ok) {
    const error = new Error(`Failed to fetch package details (${response.status})`);
    (error as { status?: number }).status = response.status;
    if (response.status >= 500 || response.status === 429) {
      throw error;
    }
    return null;
  }
  
  const text = await response.text();
  const data = JSON.parse(text) as { 
    status: boolean; 
    data: { 
      test_series: Array<{ 
        all_tests: Z7iTest[] 
      }> 
    } 
  };
  
  if (data.status && data.data.test_series?.[0]?.all_tests) {
    return { tests: data.data.test_series[0].all_tests };
  }
  return null;
}

export async function z7iGetScoreOverview(cookies: string[], testId: string): Promise<Z7iScoreOverview | null> {
  const response = await fetch(`${BASE_URL}/student/reports/get-score-overview/${testId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Cookie': cookies.join('; '),
      'Referer': `${BASE_URL}/student/`,
    },
  });
  
  const text = await response.text();
  const trimmed = text.trim();
  
  if (!trimmed.startsWith('{')) {
    return null;
  }
  
  const data = JSON.parse(text) as { status: boolean; data: Z7iScoreOverview };
  
  if (data.status) {
    return data.data;
  }
  return null;
}

export async function z7iGetQuestionwise(cookies: string[], testId: string): Promise<Z7iQuestion[]> {
  const response = await fetch(`${BASE_URL}/student/reports/questionwise/${testId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Cookie': cookies.join('; '),
      'Referer': `${BASE_URL}/student/`,
    },
  });
  
  const text = await response.text();
  const trimmed = text.trim();
  
  if (!trimmed.startsWith('{')) {
    return [];
  }
  
  const data = JSON.parse(text) as { status: boolean; data: Z7iQuestion[] };
  
  if (data.status) {
    return data.data;
  }
  return [];
}

export const SUBJECT_MAP: Record<string, string> = {
  '6936807a52cb2b62180ddd55': 'PHYSICS',
  '6938203a74289711aa090fac': 'CHEMISTRY',
  '693820bb29ef5fb68908aca5': 'MATHEMATICS',
};
