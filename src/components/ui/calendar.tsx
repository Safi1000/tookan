"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "./utils";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 bg-card dark:bg-[#1A2C53]", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium text-heading dark:text-[#C1EEFA]",
        nav: "flex items-center gap-1",
        nav_button: cn(
          "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors",
          "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100",
          "text-heading dark:text-[#C1EEFA] hover:bg-muted dark:hover:bg-[#223560]",
          "border border-input-border dark:border-[#2A3C63]"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse",
        head_row: "flex justify-center",
        head_cell: "text-muted-foreground dark:text-[#99BFD1] rounded-md w-9 font-normal text-[0.8rem]",
        row: "flex w-full mt-2 justify-center",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "[&:has([aria-selected])]:bg-[#DE3544]/20 dark:[&:has([aria-selected])]:bg-[#C1EEFA]/20",
          "[&:has([aria-selected])]:rounded-md h-9 w-9"
        ),
        day: cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-normal",
          "text-heading dark:text-[#C1EEFA]",
          "hover:bg-muted dark:hover:bg-[#223560] transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-[#DE3544]/50 dark:focus:ring-[#C1EEFA]/50",
          "aria-selected:opacity-100"
        ),
        day_range_start: "day-range-start",
        day_range_end: "day-range-end",
        day_selected: cn(
          "bg-[#DE3544] text-white dark:bg-[#C1EEFA] dark:text-[#0A1628]",
          "hover:bg-[#DE3544] hover:text-white dark:hover:bg-[#C1EEFA] dark:hover:text-[#0A1628]",
          "focus:bg-[#DE3544] focus:text-white dark:focus:bg-[#C1EEFA] dark:focus:text-[#0A1628]"
        ),
        day_today: "bg-muted dark:bg-[#223560] text-heading dark:text-[#C1EEFA] font-semibold",
        day_outside: "day-outside text-muted-foreground dark:text-[#5B7894] opacity-50",
        day_disabled: "text-muted-foreground dark:text-[#5B7894] opacity-50",
        day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className: iconClassName, ...iconProps }) => (
          <ChevronLeft className={cn("h-4 w-4", iconClassName)} {...iconProps} />
        ),
        IconRight: ({ className: iconClassName, ...iconProps }) => (
          <ChevronRight className={cn("h-4 w-4", iconClassName)} {...iconProps} />
        ),
      }}
      {...props}
    />
  );
}

export { Calendar };
