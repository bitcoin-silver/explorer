import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    // Instead of parsing the TS file, simply return an empty object if the file doesn't exist
    // This allows the admin to start adding addresses
    const filePath = path.join(process.cwd(), 'config', 'known-addresses.ts');
    
    if (!existsSync(filePath)) {
      // Create the file with basic structure if it doesn't exist
      const initialContent = `export interface KnownAddress {
  label: string;
  description?: string;
  type: 'developer' | 'exchange' | 'funding' | 'team' | 'foundation' | 'other';
  verified: boolean;
}

const knownAddresses: Record<string, KnownAddress> = {
  // Addresses will be added here by the admin interface
};

export default knownAddresses;

export function getKnownAddress(address: string): KnownAddress | null {
  return knownAddresses[address] || null;
}

export function isKnownAddress(address: string): boolean {
  return address in knownAddresses;
}`;
      
      await writeFile(filePath, initialContent, 'utf8');
      return NextResponse.json({ addresses: {} });
    }
    
    // For existing files, use a more direct approach - read the actual knownAddresses module
    // This requires the server to be restarted when changes are made
    // Delete require cache to ensure we get fresh data
    try {
      // For Next.js API routes, use dynamic import instead of require
      const knownAddressesModule = await import('@/config/known-addresses');
      const addresses = knownAddressesModule.default;
      
      return NextResponse.json({ addresses });
    } catch (importError) {
      console.error('Error importing known addresses:', importError);
      return NextResponse.json({ addresses: {} });
    }
  } catch (error) {
    console.error('Error reading known addresses:', error);
    return NextResponse.json({ error: 'Failed to read addresses' }, { status: 500 });
  }
}

// Update the POST handler to better handle updates
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const { address, data } = await request.json();
    
    // Validate input
    if (!address || !data || !data.label || !data.type) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }
    
    // Strict address format validation (Bitcoin address format)
    // Only alphanumeric characters, typical length 26-35
    if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) && 
        !/^bc1[a-z0-9]{39,59}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
    }
    
    // Validate type enum
    const validTypes = ['developer', 'exchange', 'funding', 'team', 'foundation', 'other'];
    if (!validTypes.includes(data.type)) {
      return NextResponse.json({ error: 'Invalid address type' }, { status: 400 });
    }
    
    // Validate and sanitize string fields
    const sanitizeString = (str: string, maxLength: number = 255): string => {
      if (typeof str !== 'string') return '';
      return str.slice(0, maxLength)
        .replace(/[<>\"'`]/g, '') // Remove potentially dangerous characters
        .trim();
    };
    
    const safeLabel = sanitizeString(data.label, 100);
    const safeDesc = sanitizeString(data.description || '', 500);
    
    if (!safeLabel) {
      return NextResponse.json({ error: 'Invalid label' }, { status: 400 });
    }
    
    // Ensure file is in correct directory (path traversal prevention)
    const filePath = path.join(process.cwd(), 'config', 'known-addresses.ts');
    const resolvedPath = path.resolve(filePath);
    const allowedDir = path.resolve(path.join(process.cwd(), 'config'));
    
    if (!resolvedPath.startsWith(allowedDir)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    
    // Read current file
    let fileContent = await readFile(resolvedPath, 'utf8');
    
    // Escape quotes to prevent code injection
    const escapedLabel = safeLabel.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedDesc = safeDesc.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    
    // Create the new entry with escaped values
    const newEntry = `  "${address}": {\n    label: "${escapedLabel}",\n    description: "${escapedDesc}",\n    type: "${data.type}",\n    verified: ${data.verified === true ? 'true' : 'false'}\n  },\n`;
    
    const isUpdate = fileContent.includes(`"${address}":`);
    
    if (isUpdate) {
      // More precise update pattern that matches the whole address block
      const pattern = new RegExp(`\\s*"${address}":\\s*{[^}]*},?\\n?`, 'g');
      fileContent = fileContent.replace(pattern, newEntry);
    } else {
      // Add new entry - insert after opening bracket
      fileContent = fileContent.replace(/(const knownAddresses[^{]*{)/, `$1\n${newEntry}`);
    }
    
    await writeFile(resolvedPath, fileContent, 'utf8');
    
    return NextResponse.json({ 
      success: true,
      action: isUpdate ? 'updated' : 'added'
    });
  } catch (error) {
    console.error('Error updating known addresses:', error);
    return NextResponse.json({ error: 'Failed to update addresses' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Get the address from the URL
  const url = new URL(request.url);
  const address = url.searchParams.get('address');
  
  if (!address) {
    return NextResponse.json({ error: 'No address provided' }, { status: 400 });
  }
  
  // Strict address validation before processing
  if (!/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) && 
      !/^bc1[a-z0-9]{39,59}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }
  
  try {
    // Ensure file is in correct directory (path traversal prevention)
    const filePath = path.join(process.cwd(), 'config', 'known-addresses.ts');
    const resolvedPath = path.resolve(filePath);
    const allowedDir = path.resolve(path.join(process.cwd(), 'config'));
    
    if (!resolvedPath.startsWith(allowedDir)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }
    
    // Read current file
    let fileContent = await readFile(resolvedPath, 'utf8');
    
    // Check if the address exists in the file
    if (!fileContent.includes(`"${address}":`)) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }
    
    // Remove the address entry
    fileContent = fileContent.replace(
      new RegExp(`\\s*"${address}":\\s*{[^}]*},?\\n?`, 'g'), 
      ''
    );
    
    // Clean up any trailing commas in the object
    fileContent = fileContent.replace(/,(\s*})/g, '$1');
    
    await writeFile(resolvedPath, fileContent, 'utf8');
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting known address:', error);
    return NextResponse.json({ error: 'Failed to delete address' }, { status: 500 });
  }
}
