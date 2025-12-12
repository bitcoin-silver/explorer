import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import path from 'path';
import { timingSafeEqual, createHash } from 'crypto';

// Set this in your .env file - REQUIRED for security
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD environment variable is required');
}

// Hash the password for comparison (using timing-safe comparison)
const passwordHash = createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

// Timing-safe password authentication
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const tokenHash = createHash('sha256').update(token).digest('hex');
  
  try {
    // Use timing-safe comparison to prevent timing attacks
    return timingSafeEqual(Buffer.from(tokenHash), Buffer.from(passwordHash));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  // Only allow in development mode for safety
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'This endpoint is only available in development mode' }, { status: 403 });
  }
  
  // Check authorization
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    // Ensure file is in correct directory (path traversal prevention)
    const triggerPath = path.join(process.cwd(), 'tmp', 'reload-trigger.txt');
    const resolvedPath = path.resolve(triggerPath);
    const allowedDir = path.resolve(path.join(process.cwd(), 'tmp'));
    
    if (!resolvedPath.startsWith(allowedDir)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    
    // Create a temporary file change to trigger Next.js hot reload
    const timestamp = new Date().toISOString();
    await writeFile(resolvedPath, `Server reload triggered at ${timestamp}`);
    
    return NextResponse.json({ success: true, message: 'Reload signal sent' });
  } catch (error) {
    console.error('Error triggering reload:', error);
    return NextResponse.json({ error: 'Failed to trigger reload' }, { status: 500 });
  }
}