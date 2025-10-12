"use client";

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useNotification } from '@/components/ui/sooner';
import { Search as SearchIcon } from 'lucide-react';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const showNotification = useNotification();

  // Detect what type of search query it is
  const detectQueryType = (query: string): 'address' | 'tx' | 'block' | 'hash' | 'unknown' => {
    query = query.trim();

    // Adressmuster für Bitcoin Silver + klassische Bitcoin-Formate
    const addressPatterns = [
      /^B[a-zA-Z0-9]{33,34}$/,        // Bitcoin Silver P2PKH/P2SH
      /^bs1[a-z0-9]{25,62}$/i,        // Bitcoin Silver Bech32
      /^1[a-zA-Z0-9]{25,34}$/,        // Bitcoin P2PKH
      /^3[a-zA-Z0-9]{25,34}$/,        // Bitcoin P2SH
    ];

    if (addressPatterns.some(r => r.test(query))) return 'address';

    // Block height (numeric)
    if (/^\d+$/.test(query)) return 'block';

    // 64-character hex string - could be either transaction or block hash
    // Block hashes typically start with multiple zeros, transactions rarely do
    // We use a heuristic: if it starts with 4+ zeros, likely a block hash
    if (/^[a-fA-F0-9]{64}$/.test(query)) {
      if (/^0{4,}/.test(query)) {
        return 'hash'; // Likely a block hash
      }
      return 'tx'; // Likely a transaction
    }

    return 'unknown';
  };

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) {
      showNotification({
        type: "warning",
        message: "Please enter a search term"
      });
      return;
    }
    
    setLoading(true);
    
    try {
      const queryType = detectQueryType(query);
      
      switch (queryType) {
        case 'address':
          router.push(`/address/${query.trim()}`);
          break;
        case 'tx':
          router.push(`/tx/${query.trim()}`);
          break;
        case 'block':
        case 'hash':
          // Both block height and block hash go to /block/[height]
          // The block page now handles both cases
          router.push(`/block/${query.trim()}`);
          break;
        default:
          // If we can't determine the type, try to query the API for more info
          showNotification({
            type: "error",
            message: "Could not identify search term type. Please check your input."
          });
          setLoading(false);
      }
    } catch {
      showNotification({
        type: "error",
        message: "Error processing search"
      });
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Search Blockchain</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearch} className="space-y-6">
              <div className="space-y-2">
                <p className="text-sm text-gray-500">
                  Search for addresses, transactions, or blocks
                </p>
                <div className="flex gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Address, Transaction ID, Block Height/Hash"
                    className="flex-1"
                  />
                  <Button type="submit" disabled={loading}>
                    {loading ? "Searching..." : <SearchIcon className="h-4 w-4 mr-2" />}
                    Search
                  </Button>
                </div>
              </div>
              
              <div className="text-sm text-gray-500 space-y-2">
                <h3 className="font-medium text-gray-700">Examples:</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Address: TpFA1tzWgz1t2G8edzi65G5UJLkNscgXHX</li>
                  <li>Transaction: c4e9ca391143df0ea9e19a6d3a63a1e2f1c14cfde7dca2a4066af94efd71c085</li>
                  <li>Block: 7754 or 0000007754bb9a3f62a2928f7283570fb8084abf2f28020e0a6ab069e929b2a3</li>
                </ul>
              </div>
            </form>
          </CardContent>
        </Card>
        
        {/* Add some tips or explanations */}
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Address Search</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                Search for wallet addresses to view balance, transactions, and other details.
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Transaction Search</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                Look up transaction details including inputs, outputs, fees, and confirmations.
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Block Search</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                Explore blocks by height or hash to view included transactions and mining details.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}