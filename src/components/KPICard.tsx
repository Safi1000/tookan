import { LucideIcon } from 'lucide-react';

interface KPICardProps {
  id: string;
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: string;
}

export function KPICard({ label, value, icon: Icon, trend }: KPICardProps) {
  const isPositive = trend?.startsWith('+');
  const isNegative = trend?.startsWith('-');

  return (
    <div className="bg-card rounded-2xl border border-border dark:border-[#DE3544]/20 p-6 hover:border-primary/50 dark:hover:border-[#DE3544]/50 hover:shadow-lg dark:hover:shadow-[0_0_24px_rgba(222,53,68,0.15)] transition-all cursor-pointer group shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <p className="text-subheading dark:text-[#99BFD1] text-sm mb-1 font-medium">{label}</p>
          <p className="text-heading dark:text-foreground text-3xl font-semibold">{value}</p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-primary/10 dark:bg-[#DE3544]/20 flex items-center justify-center group-hover:scale-110 transition-transform border border-primary/20 dark:border-[#DE3544]/30">
          <Icon className="w-6 h-6 text-primary dark:text-[#DE3544]" />
        </div>
      </div>
      
      {trend && (
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${
            isPositive ? 'text-green-600 dark:text-green-400' : 
            isNegative ? 'text-[#DE3544] dark:text-[#DE3544]' : 
            'text-subheading dark:text-[#99BFD1]'
          }`}>
            {trend}
          </span>
          <span className="text-muted-light dark:text-muted-foreground text-sm">vs last period</span>
        </div>
      )}
    </div>
  );
}