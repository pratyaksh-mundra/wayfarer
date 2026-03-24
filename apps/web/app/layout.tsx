import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wayfarer — Reddit-powered travel itineraries',
  description: 'Type a destination. Get a day-by-day itinerary built from real Reddit travel advice, verified with Google Places.',
  openGraph: {
    title: 'Wayfarer — Reddit-powered travel itineraries',
    description: 'Type a destination. Get a day-by-day itinerary built from real Reddit travel advice, verified with Google Places.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Wayfarer — Reddit-powered travel itineraries',
    description: 'Type a destination. Get a day-by-day itinerary built from real Reddit travel advice, verified with Google Places.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  )
}
