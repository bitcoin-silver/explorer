// app/blocks/page.tsx
import { Metadata } from "next";
import clientPromise from "@/lib/mongodb";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, timeAgo } from "@/lib/utils";
import Link from "next/link";
import { Clock, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { Block } from "@/lib/models";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: `Blocks | ${process.env.NEXT_PUBLIC_COIN_NAME} Explorer`,
  description: `Browse all blocks on the ${process.env.NEXT_PUBLIC_COIN_NAME} blockchain`,
};

export const revalidate = 0; // Immer aktuell

interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  totalItems: number;
}

async function getBlocks(page: number = 1, limit: number = 25) {
  const client = await clientPromise;
  const db = client.db();

  const skip = (page - 1) * limit;

  const totalItems = await db.collection("blocks").countDocuments();
  const totalPages = Math.ceil(totalItems / limit);

  const blocks = await db
    .collection("blocks")
    .find({})
    .sort({ height: -1 })
    .skip(skip)
    .limit(limit)
    .toArray() as Block[];

  return { blocks, pagination: { page, limit, totalPages, totalItems } };
}

export default async function BlocksPage({ searchParams }: { searchParams?: { page?: string } }) {
  const page = Math.max(parseInt(searchParams?.page || "1", 10), 1);
  const { blocks, pagination } = await getBlocks(page);

  const createPageUrl = (pageNum: number) => `/blocks?page=${pageNum}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Blocks</h1>
        <p className="text-muted-foreground">
          Browse all blocks on the {process.env.NEXT_PUBLIC_COIN_NAME} blockchain
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Layers className="h-5 w-5 mr-2" />
            All Blocks
          </CardTitle>
          <CardDescription>
            Total of {formatNumber(pagination.totalItems)} blocks mined
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Height</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Transactions</TableHead>
                <TableHead className="text-right">Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.map((block) => (
                <TableRow key={block.hash}>
                  <TableCell>
                    <Link href={`/block/${block.height}`} className="hover:underline text-primary">
                      {block.height}
                    </Link>
                  </TableCell>
                  <TableCell className="flex items-center">
                    <Clock className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                    {timeAgo(block.timestamp * 1000)}
                  </TableCell>
                  <TableCell>{block.txs?.length || 0}</TableCell>
                  <TableCell className="text-right">{formatNumber(block.size)} bytes</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-center space-x-2 mt-6">
              <Link href={createPageUrl(1)}>
                <Button variant="outline" size="sm" disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                  <ChevronLeft className="h-4 w-4 -ml-2" />
                </Button>
              </Link>

              <Link href={createPageUrl(Math.max(page - 1, 1))}>
                <Button variant="outline" size="sm" disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Prev
                </Button>
              </Link>

              <div className="text-sm">
                Page {page} of {pagination.totalPages}
              </div>

              <Link href={createPageUrl(Math.min(page + 1, pagination.totalPages))}>
                <Button variant="outline" size="sm" disabled={page === pagination.totalPages}>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>

              <Link href={createPageUrl(pagination.totalPages)}>
                <Button variant="outline" size="sm" disabled={page === pagination.totalPages}>
                  <ChevronRight className="h-4 w-4" />
                  <ChevronRight className="h-4 w-4 -ml-2" />
                </Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
