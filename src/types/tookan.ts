/**
 * Type definitions for Tookan API entities
 */

export interface Driver {
  id: string;
  fleet_id?: number;
  name: string;
  phone: string;
  balance: number;
  pending: number;
}

export interface Customer {
  id: string;
  vendor_id?: number;
  name: string;
  phone: string;
  balance: number;
  pending: number;
  email?: string;
}

export interface Merchant {
  id: string;
  vendor_id?: number;
  name: string;
  phone: string;
  balance: number;
  pending: number;
  email?: string;
}

export interface WalletTransaction {
  id: string;
  entityId: string;
  entityType: 'driver' | 'customer' | 'merchant';
  amount: number;
  type: 'credit' | 'debit';
  description: string;
  date: string;
  balanceAfter?: number;
}

