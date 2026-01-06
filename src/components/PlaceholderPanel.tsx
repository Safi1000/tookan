import { FileQuestion } from 'lucide-react';

interface PlaceholderPanelProps {
  title: string;
}

export function PlaceholderPanel({ title }: PlaceholderPanelProps) {
  return (
    <div className="p-8 h-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="w-24 h-24 rounded-2xl bg-[#DE3544]/20 flex items-center justify-center mx-auto mb-6 border border-[#DE3544]/30">
          <FileQuestion className="w-12 h-12 text-[#DE3544]" />
        </div>
        <h2 className="text-foreground text-2xl mb-3">{title}</h2>
        <p className="text-muted-foreground mb-6">
          This panel is under development. The interface for {title.toLowerCase()} will be available soon.
        </p>
        <div className="inline-flex items-center gap-2 px-6 py-3 bg-card border border-border rounded-xl shadow-sm transition-colors duration-300">
          <span className="w-2 h-2 bg-[#C1EEFA] rounded-full animate-pulse" />
          <span className="text-muted-foreground text-sm">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}