'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ManifestBlock({ manifest }: { manifest: string }) {
  function copy() {
    navigator.clipboard
      .writeText(manifest)
      .then(() => toast.success('Manifest copied'))
      .catch(() =>
        toast.error('Could not copy. Select the manifest and copy manually.'),
      );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2">
        <span className="text-[12px] text-text-subtle">app-manifest.yaml</span>
        <Button type="button" variant="ghost" size="sm" onClick={copy}>
          Copy manifest
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto bg-transparent px-4 py-3 font-mono text-[12px] leading-5 text-text">
        {manifest}
      </pre>
    </div>
  );
}
