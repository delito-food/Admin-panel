import { clsx, type ClassValue } from 'clsx';

// Utility function for conditional class names
export function cn(...inputs: ClassValue[]) {
    return clsx(inputs);
}

// Format currency in Indian Rupees
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
    }).format(amount);
}

// Format date to readable string
export function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    }).format(date);
}

// Format date with time
export function formatDateTime(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

// Get relative time (e.g., "2 hours ago")
export function getRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hr ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;

    return formatDate(dateString);
}

// Truncate text with ellipsis
export function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
}

// Get initials from name
export function getInitials(name: string): string {
    return name
        .split(' ')
        .map(word => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

// Get status color class
export function getStatusColor(status: string): string {
    const statusLower = status.toLowerCase();

    if (['delivered', 'approved', 'completed', 'online'].includes(statusLower)) {
        return 'badge-approved';
    }
    if (['pending', 'preparing', 'accepted'].includes(statusLower)) {
        return 'badge-pending';
    }
    if (['cancelled', 'rejected', 'declined', 'offline'].includes(statusLower)) {
        return 'badge-rejected';
    }
    if (['active', 'picked up', 'sent for delivery'].includes(statusLower)) {
        return 'badge-active';
    }

    return 'badge-pending';
}

// Calculate percentage change
export function calculateChange(current: number, previous: number): {
    value: number;
    isPositive: boolean;
    formatted: string;
} {
    if (previous === 0) {
        return { value: 100, isPositive: true, formatted: '+100%' };
    }

    const change = ((current - previous) / previous) * 100;
    const isPositive = change >= 0;
    const formatted = `${isPositive ? '+' : ''}${change.toFixed(1)}%`;

    return { value: Math.abs(change), isPositive, formatted };
}

// Debounce function
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;

    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// Generate random ID
export function generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Sleep utility for animations
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
