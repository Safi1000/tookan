"use client"

import * as React from "react"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { cn } from "./utils"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "./popover"
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import dayjs, { Dayjs } from 'dayjs';
import { ThemeProvider, createTheme } from '@mui/material/styles';

interface DatePickerProps {
    value?: string
    onChange: (date: string) => void
    placeholder?: string
    className?: string
}

// Create a dark theme for MUI components to match the dashboard
const darkTheme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#DE3544', // Consistent with Turbo Bahrain Red
        },
        background: {
            paper: '#1A2C53', // Match dashboard card background
        },
        text: {
            primary: '#C1EEFA',
        },
    },
});

export function DatePicker({ value, onChange, placeholder = "YYYY-MM-DD", className }: DatePickerProps) {
    const [inputValue, setInputValue] = React.useState(value || "");
    const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);

    // Sync input value with prop value when it changes externally
    React.useEffect(() => {
        setInputValue(value || "");
    }, [value]);

    // Convert string "YYYY-MM-DD" to dayjs object for MUI Calendar
    const selectedDate = React.useMemo(() => {
        if (!value) return null;
        const d = dayjs(value, "YYYY-MM-DD");
        return d.isValid() ? d : null;
    }, [value]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let newValue = e.target.value;

        // Remove all non-digits
        newValue = newValue.replace(/\D/g, "");

        // Limit to 8 digits (YYYYMMDD)
        if (newValue.length > 8) {
            newValue = newValue.substring(0, 8);
        }

        // Apply masking: YYYY-MM-DD
        let maskedValue = "";
        if (newValue.length > 0) {
            maskedValue = newValue.substring(0, 4);
            if (newValue.length > 4) {
                maskedValue += "-" + newValue.substring(4, 6);
                if (newValue.length > 6) {
                    maskedValue += "-" + newValue.substring(6, 8);
                }
            }
        }

        setInputValue(maskedValue);

        // Notify parent if it's a complete valid date or empty
        if (maskedValue.length === 10) {
            const [year, month, day] = maskedValue.split('-').map(Number);
            const date = new Date(year, month - 1, day);
            if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
                onChange(maskedValue);
            }
        } else if (maskedValue === "") {
            onChange("");
        }
    };

    const handleCalendarSelect = (newDate: Dayjs | null) => {
        if (newDate && newDate.isValid()) {
            const formatted = newDate.format("YYYY-MM-DD");
            setInputValue(formatted);
            onChange(formatted);
            setIsPopoverOpen(false);
        } else {
            onChange("");
            setInputValue("");
        }
    };

    const handleClear = () => {
        onChange("");
        setInputValue("");
    };

    return (
        <div className={cn("relative flex items-center w-full group", className)}>
            {/* Typable Input */}
            <input
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                placeholder={placeholder}
                className={cn(
                    "w-full bg-input-bg dark:bg-[#1A2C53]",
                    "border border-input-border dark:border-[#2A3C63]",
                    "rounded-xl px-4 py-2.5 pr-20", // Extra padding right for icons
                    "text-sm text-heading dark:text-[#C1EEFA]",
                    "placeholder:text-muted-foreground dark:placeholder:text-[#5B7894]",
                    "focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA]",
                    "transition-all"
                )}
            />

            <div className="absolute right-3 flex items-center gap-1">
                {/* Clear Button */}
                {inputValue && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className={cn(
                            "flex items-center justify-center w-7 h-7 rounded-md",
                            "text-[#99BFD1] hover:text-[#DE3544] dark:hover:text-[#C1EEFA]",
                            "hover:bg-muted/50 dark:hover:bg-[#223560]/50",
                            "transition-all"
                        )}
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}

                {/* Calendar Popover Trigger */}
                <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                "flex items-center justify-center w-7 h-7 rounded-md",
                                "text-[#99BFD1] hover:text-[#DE3544] dark:hover:text-[#C1EEFA]",
                                "hover:bg-muted/50 dark:hover:bg-[#223560]/50",
                                "transition-all",
                                isPopoverOpen && "text-[#DE3544] dark:text-[#C1EEFA] bg-muted/50 dark:bg-[#223560]/50"
                            )}
                        >
                            <CalendarIcon className="w-4 h-4" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 border-none shadow-premium dark:shadow-premium-dark rounded-xl" align="end">
                        <ThemeProvider theme={darkTheme}>
                            <LocalizationProvider dateAdapter={AdapterDayjs}>
                                <div className="bg-[#1A2C53] border border-border dark:border-[#2A3C63] rounded-xl overflow-hidden shadow-2xl">
                                    <DateCalendar
                                        value={selectedDate}
                                        onChange={handleCalendarSelect}
                                        sx={{
                                            backgroundColor: '#1A2C53',
                                            color: '#C1EEFA',
                                            borderRadius: '12px',
                                            '& .MuiTypography-root': { color: '#C1EEFA' },
                                            '& .MuiSvgIcon-root': { color: '#C1EEFA' },
                                            '& .MuiPickersCalendarHeader-label': { color: '#C1EEFA', fontWeight: 'bold' },
                                            '& .MuiDayCalendar-weekDayLabel': { color: '#99BFD1' },
                                            '& .MuiPickersDay-root': {
                                                color: '#C1EEFA',
                                                '&:hover': {
                                                    backgroundColor: 'rgba(222, 53, 68, 0.1) !important',
                                                },
                                                '&.Mui-selected': {
                                                    backgroundColor: '#DE3544 !important',
                                                    color: '#fff !important',
                                                },
                                            },
                                        }}
                                    />
                                </div>
                            </LocalizationProvider>
                        </ThemeProvider>
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    )
}
