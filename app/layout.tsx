import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import 'katex/dist/katex.min.css';
import '../src/index.css';
import '../src/test-card-blur.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#080b12',
};

const SITE_URL = 'https://z7i.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Z7i Scraper',
    template: '%s | Z7i Scraper',
  },
  description:
    'Analyze your JEE test performance, practice past-year questions (PYQs), track your progress with detailed analytics, and study smarter with AI-powered doubt solving.',
  keywords: [
    'JEE',
    'JEE Main',
    'JEE Advanced',
    'JEE preparation',
    'JEE test analysis',
    'PYQ practice',
    'past year questions',
    'JEE mock test',
    'test analytics',
    'Z7I',
    'IIT JEE',
    'JEE score analysis',
  ],
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'Z7I',
    title: 'Z7I – JEE Test Analysis & PYQ Practice',
    description:
      'Analyze JEE tests, practice PYQs, and study smarter with detailed performance analytics and AI-powered assistance.',
    url: SITE_URL,
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
        alt: 'Z7I Logo',
      },
    ],
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary',
    title: 'Z7I – JEE Test Analysis & PYQ Practice',
    description:
      'Analyze JEE tests, practice PYQs, and study smarter with detailed performance analytics.',
    images: ['/icon-512.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Z7I',
  },
  icons: {
    icon: '/z7iscrapper.ico',
    apple: '/z7iscrapper.ico',
  },
  category: 'education',
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Z7I',
  url: SITE_URL,
  description:
    'Analyze your JEE test performance, practice past-year questions, and study smarter with AI-powered doubt solving.',
  applicationCategory: 'EducationalApplication',
  operatingSystem: 'Web',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'INR',
  },
  audience: {
    '@type': 'EducationalAudience',
    educationalRole: 'student',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Script
          id="json-ld"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js');
          }
        `}</Script>
      </body>
    </html>
  );
}
