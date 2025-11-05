import '@/app/globals.css';
import { Inter } from 'next/font/google';
import { NavbarWrapper } from '@/components/navbar';
import { NotificationProvider } from '@/components/ui/sooner';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: process.env.NEXT_PUBLIC_COIN_NAME + ' Explorer',
  description: 'Blockchain explorer for ' + process.env.NEXT_PUBLIC_COIN_NAME,
  metadataBase: new URL('https://chain.tenzura.io'),
  other: {
    'Cache-Control': 'no-store, max-age=0',
  },
};

// Server component that fetches blockchain data
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <NotificationProvider>
          <div className="flex min-h-screen flex-col">
            {/* NavbarWrapper handles the client-side functionality */}
            <NavbarWrapper />
            
            <main className="flex-1 flex justify-center w-full py-8 mt-24">
              <div className="w-full max-w-7xl px-6 sm:px-8">
                {children}
              </div>
            </main>
            
            <footer className="border-t py-6">
              <div className="flex justify-center w-full">
                <div className="w-full max-w-7xl px-6 sm:px-8 text-sm">
                  <div className="flex flex-col md:flex-row md:justify-between items-center gap-4">
                    <div className="text-center md:text-left">
                      © {new Date().getFullYear()} {process.env.NEXT_PUBLIC_COIN_NAME} Explorer
                    </div>
                    <div className="flex items-center space-x-6">
                      <div className="flex items-center">
                        <span>
                          Built with ⚡ by the <a href="https://bitcoinsilver.top" target="_blank">Bitcoin Silver</a> community
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </footer>
          </div>
        </NotificationProvider>
      </body>
    </html>
  );
}
