import { useState, useEffect } from 'react';
import { DollarSign, Wallet, CheckCircle, X, Search, Calendar, Save, Check, XCircle, Eye, Download, Loader2, AlertCircle } from 'lucide-react';
import { 
  createFleetWalletTransaction, 
  fetchFleetWalletBalance,
  addCustomerWalletPayment,
  fetchCustomerWallet,
  fetchDriverCODQueue,
  getOldestPendingCOD,
  settleCODTransaction,
  fetchCODConfirmations,
  fetchCODCalendar,
  fetchCustomerWallets,
  fetchCODQueue,
  settleCOD,
  fetchAllDrivers,
  fetchAllCustomers,
  type TookanApiResponse,
  type CODEntry,
  type CODConfirmation,
  type CODCalendarEntry,
  type CustomerWallet
} from '../services/tookanApi';
import { toast } from 'sonner';

// Calendar entry interface
interface CalendarEntry {
  date: string;
  codReceived: number;
  codPending: number;
  balancePaid: number;
  note: string;
  codStatus?: 'PENDING' | 'COMPLETED';
  codId?: string;
  merchantVendorId?: number;
}

// Driver interface
interface Driver {
  id: string;
  fleet_id: number | string;
  name: string;
  phone?: string;
  pending?: number;
  balance?: number;
}

// Merchant interface
interface Merchant {
  id: string;
  vendor_id: number | string;
  name: string;
  phone?: string;
  balance?: number;
  pending?: number;
}

export function FinancialPanel() {
  // Read settings from localStorage with state to trigger re-renders
  // COD Confirmation is hidden from UI but code remains intact
  const getShowCODSection = () => false; // Always return false - COD section hidden
  const getShowDriverWalletSection = () => localStorage.getItem('showDriverWalletSection') !== 'false';
  const getShowMerchantWalletSection = () => localStorage.getItem('showMerchantWalletSection') !== 'false';
  
  const [showCODSection, setShowCODSection] = useState(false); // Always false - COD section hidden
  const [showDriverWalletSection, setShowDriverWalletSection] = useState(getShowDriverWalletSection());
  const [showMerchantWalletSection, setShowMerchantWalletSection] = useState(getShowMerchantWalletSection());
  
  // Listen for storage changes to update state
  useEffect(() => {
    const handleStorageChange = () => {
      setShowCODSection(getShowCODSection());
      setShowDriverWalletSection(getShowDriverWalletSection());
      setShowMerchantWalletSection(getShowMerchantWalletSection());
    };
    
    window.addEventListener('storage', handleStorageChange);
    // Also listen for custom event for same-tab updates
    window.addEventListener('settingsUpdated', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('settingsUpdated', handleStorageChange);
    };
  }, []);
  
  // Determine available tabs
  // COD Confirmation tab is hidden but code remains
  const availableTabs: Array<'reconciliation' | 'cod' | 'driver-wallets' | 'merchant-wallets'> = [
    'reconciliation',
    // ...(showCODSection ? (['cod'] as const) : []), // COD tab hidden
    ...(showDriverWalletSection ? (['driver-wallets'] as const) : []),
    ...(showMerchantWalletSection ? (['merchant-wallets'] as const) : [])
  ];
  
  // Ensure activeTab is valid, default to reconciliation if current tab is hidden
  const getInitialTab = (): 'reconciliation' | 'cod' | 'driver-wallets' | 'merchant-wallets' => {
    const saved = localStorage.getItem('financialPanelActiveTab');
    if (saved && availableTabs.includes(saved as any)) {
      return saved as 'reconciliation' | 'cod' | 'driver-wallets' | 'merchant-wallets';
    }
    return 'reconciliation';
  };
  
  const [activeTab, setActiveTab] = useState<'reconciliation' | 'cod' | 'driver-wallets' | 'merchant-wallets'>(getInitialTab());
  
  // Update activeTab if current tab becomes hidden
  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab('reconciliation');
      localStorage.setItem('financialPanelActiveTab', 'reconciliation');
    }
  }, [showCODSection, showDriverWalletSection, showMerchantWalletSection, activeTab, availableTabs]);
  
  // Save active tab to localStorage when it changes
  const handleTabChange = (tab: 'reconciliation' | 'cod' | 'driver-wallets' | 'merchant-wallets') => {
    setActiveTab(tab);
    localStorage.setItem('financialPanelActiveTab', tab);
  };
  
  // Reconciliation state
  const [unifiedDriverSearch, setUnifiedDriverSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchValidation, setSearchValidation] = useState<'valid' | 'invalid' | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [calendarData, setCalendarData] = useState<CalendarEntry[]>([]);
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingCODStatus, setEditingCODStatus] = useState<'PENDING' | 'COMPLETED' | null>(null);
  const [isProcessingCOD, setIsProcessingCOD] = useState(false);
  const [codError, setCodError] = useState<string | null>(null);

  // Wallet state
  const [driverWalletSearch, setDriverWalletSearch] = useState('');
  const [driverWalletValidation, setDriverWalletValidation] = useState<'valid' | 'invalid' | null>(null);
  const [merchantWalletSearch, setMerchantWalletSearch] = useState('');
  const [merchantWalletValidation, setMerchantWalletValidation] = useState<'valid' | 'invalid' | null>(null);
  const [editingBalance, setEditingBalance] = useState<{ type: 'driver' | 'merchant'; id: string } | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const [balanceNote, setBalanceNote] = useState('');
  const [isProcessingWallet, setIsProcessingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  // COD Confirmation state
  const [codSearch, setCodSearch] = useState('');
  const [codDateFrom, setCodDateFrom] = useState('');
  const [codDateTo, setCodDateTo] = useState('');
  const [codStatusFilter, setCodStatusFilter] = useState<'all' | 'Pending' | 'Confirmed' | 'Rejected'>('all');
  const [codConfirmations, setCodConfirmations] = useState<CODConfirmation[]>([]);
  const [isLoadingCODConfirmations, setIsLoadingCODConfirmations] = useState(false);
  const [selectedCod, setSelectedCod] = useState<string | null>(null);
  const [codNote, setCodNote] = useState('');
  
  // Merchant wallets state
  const [merchantWallets, setMerchantWallets] = useState<CustomerWallet[]>([]);
  const [isLoadingMerchantWallets, setIsLoadingMerchantWallets] = useState(false);
  
  // Real data state
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(false);
  const [isLoadingMerchants, setIsLoadingMerchants] = useState(false);
  
  // Fetch drivers on mount
  useEffect(() => {
    const loadDrivers = async () => {
      setIsLoadingDrivers(true);
      try {
        const response = await fetchAllDrivers();
        if (response.status === 'success' && response.data?.fleets) {
          const fleets = response.data.fleets;
          const driversList: Driver[] = fleets.map((fleet: any) => ({
            id: fleet.id?.toString() || fleet.fleet_id?.toString() || '',
            fleet_id: fleet.fleet_id || fleet.id || '',
            name: fleet.fleet_name || fleet.name || 'Unknown Driver',
            phone: fleet.fleet_phone || fleet.phone || '',
            pending: 0,
            balance: 0
          }));
          setDrivers(driversList);
        } else {
          toast.error(response.message || 'Failed to load drivers');
        }
      } catch (error) {
        console.error('Error loading drivers:', error);
        toast.error('Failed to load drivers');
      } finally {
        setIsLoadingDrivers(false);
      }
    };
    loadDrivers();
  }, []);
  
  // Fetch merchants on mount
  useEffect(() => {
    const loadMerchants = async () => {
      setIsLoadingMerchants(true);
      try {
        const response = await fetchAllCustomers();
        if (response.status === 'success' && response.data?.customers) {
          const merchantsList = response.data.customers;
          const merchantsData: Merchant[] = merchantsList.map((merchant: any) => ({
            id: merchant.id?.toString() || merchant.vendor_id?.toString() || '',
            vendor_id: merchant.vendor_id || merchant.id || '',
            name: merchant.customer_name || merchant.name || 'Unknown Merchant',
            phone: merchant.customer_phone || merchant.phone || '',
            balance: 0,
            pending: 0
          }));
          setMerchants(merchantsData);
        } else {
          toast.error(response.message || 'Failed to load merchants');
        }
      } catch (error) {
        console.error('Error loading merchants:', error);
        toast.error('Failed to load merchants');
      } finally {
        setIsLoadingMerchants(false);
      }
    };
    loadMerchants();
  }, []);
  
  // Load COD confirmations on mount
  useEffect(() => {
    const loadCODConfirmations = async () => {
      setIsLoadingCODConfirmations(true);
      try {
        const response = await fetchCODConfirmations();
        if (response.status === 'success' && response.data) {
          setCodConfirmations(Array.isArray(response.data) ? response.data : []);
        }
      } catch (error) {
        console.error('Error loading COD confirmations:', error);
      } finally {
        setIsLoadingCODConfirmations(false);
      }
    };
    loadCODConfirmations();
  }, []);
  
  // Load calendar data on mount and when date range changes
  useEffect(() => {
    const loadCalendarData = async () => {
      setIsLoadingCalendar(true);
      try {
        const response = await fetchCODCalendar(dateFrom || undefined, dateTo || undefined);
        if (response.status === 'success' && response.data) {
          const calendarEntries: CalendarEntry[] = Array.isArray(response.data) 
            ? response.data.map((entry: any) => ({
                date: entry.date || entry.codDate || '',
                codReceived: parseFloat(entry.codReceived || entry.cod_received || 0),
                codPending: parseFloat(entry.codPending || entry.cod_pending || 0),
                balancePaid: parseFloat(entry.balancePaid || entry.balance_paid || 0),
                note: entry.note || entry.notes || '',
                codStatus: entry.codStatus || entry.cod_status || 'PENDING',
                codId: entry.codId || entry.cod_id,
                merchantVendorId: entry.merchantVendorId || entry.merchant_vendor_id
              }))
            : [];
          setCalendarData(calendarEntries);
        }
      } catch (error) {
        console.error('Error loading calendar data:', error);
      } finally {
        setIsLoadingCalendar(false);
      }
    };
    loadCalendarData();
  }, [dateFrom, dateTo]);

  const handleSearch = () => {
    if (!unifiedDriverSearch.trim()) {
      setSelectedDriver(null);
      setSearchValidation(null);
      localStorage.setItem('financialPanelActiveTab', 'reconciliation');
      return;
    }
    const foundDriver = drivers.find(
      d => d.name.toLowerCase().includes(unifiedDriverSearch.toLowerCase()) || 
           d.id.toLowerCase().includes(unifiedDriverSearch.toLowerCase()) ||
           (d.phone && d.phone.includes(unifiedDriverSearch))
    );
    if (foundDriver) {
      setSearchValidation('valid');
      setSelectedDriver(foundDriver.id);
    } else {
      setSearchValidation('invalid');
      setSelectedDriver(null);
    }
  };

  const handleDriverWalletSearch = async () => {
    if (!driverWalletSearch.trim()) {
      setDriverWalletValidation(null);
      return;
    }

    // Find driver in fetched drivers list
    const found = drivers.find(
      d => d.name.toLowerCase().includes(driverWalletSearch.toLowerCase()) || 
           d.id.toLowerCase().includes(driverWalletSearch.toLowerCase()) ||
           (d.phone && d.phone.includes(driverWalletSearch))
    );

    if (found) {
      setDriverWalletValidation('valid');
      
      // If driver has a fleet_id, fetch real balance from Tookan
      if (found.fleet_id) {
        try {
          const response = await fetchFleetWalletBalance(found.fleet_id);
          if (response.status === 'success' && response.data.balance !== undefined) {
            // Update the driver's balance with real data
            setDrivers(prev => prev.map(d => 
              d.id === found.id 
                ? { ...d, balance: response.data.balance || 0 }
                : d
            ));
          }
        } catch (error) {
          console.error('Error fetching driver wallet:', error);
        }
      }
    } else {
      setDriverWalletValidation('invalid');
    }
  };

  const handleMerchantWalletSearch = async () => {
    if (!merchantWalletSearch.trim()) {
      setMerchantWalletValidation(null);
      return;
    }

    const searchTerm = merchantWalletSearch.toLowerCase().trim();

    // Try to find in merchant wallets first, then in merchants list
    // Search by: name, id, vendor_id, phone
    let found = merchantWallets.find(
      m => m.name.toLowerCase().includes(searchTerm) || 
           m.id.toLowerCase().includes(searchTerm) ||
           m.vendor_id?.toString().includes(searchTerm) ||
           m.phone.includes(merchantWalletSearch)
    );

    // If not found in merchantWallets, search in merchants list
    if (!found) {
      const merchantMatch = merchants.find(
        m => m.name.toLowerCase().includes(searchTerm) || 
             m.id.toLowerCase().includes(searchTerm) ||
             m.vendor_id?.toString().includes(searchTerm) ||
             (m.phone && m.phone.includes(merchantWalletSearch))
      );
      
      if (merchantMatch) {
        // Convert merchant to CustomerWallet format for display
        found = {
          id: merchantMatch.id,
          name: merchantMatch.name,
          phone: merchantMatch.phone || '',
          balance: merchantMatch.balance || 0,
          pending: merchantMatch.pending || 0,
          vendor_id: merchantMatch.vendor_id
        } as CustomerWallet;
      }
    }

    if (found) {
      setMerchantWalletValidation('valid');
      
      // If merchant has a vendor_id, fetch real balance from Tookan
      if (found.vendor_id) {
        try {
          const response = await fetchCustomerWallet(found.vendor_id, 1, 0, 50);
          if (response.status === 'success' && response.data?.data) {
            const walletData = Array.isArray(response.data.data) 
              ? response.data.data.find((w: any) => w.vendor_id === found.vendor_id)
              : response.data.data;
            
            if (walletData?.wallet_balance !== undefined) {
              // Update the merchant's balance with real data
              console.log('Merchant wallet balance:', walletData.wallet_balance);
            }
          }
        } catch (error) {
          console.error('Error fetching merchant wallet:', error);
        }
      }
    } else {
      setMerchantWalletValidation('invalid');
    }
  };

  const handleConfirmCOD = (codId: string) => {
    setCodConfirmations(prev => prev.map(cod => 
      cod.id === codId ? { ...cod, status: 'Confirmed', notes: codNote || cod.notes } : cod
    ));
    setSelectedCod(null);
    setCodNote('');
  };

  const handleRejectCOD = (codId: string) => {
    if (codNote.trim()) {
      setCodConfirmations(prev => prev.map(cod => 
        cod.id === codId ? { ...cod, status: 'Rejected', notes: codNote } : cod
      ));
      setSelectedCod(null);
      setCodNote('');
    }
  };

  const filteredCODConfirmations = (codConfirmations || []).filter(cod => {
    const matchesSearch = !codSearch || 
      cod.id.toLowerCase().includes(codSearch.toLowerCase()) ||
      cod.orderId.toLowerCase().includes(codSearch.toLowerCase()) ||
      cod.driverName.toLowerCase().includes(codSearch.toLowerCase()) ||
      cod.merchant.toLowerCase().includes(codSearch.toLowerCase()) ||
      cod.customer.toLowerCase().includes(codSearch.toLowerCase());
    
    const matchesStatus = codStatusFilter === 'all' || cod.status === codStatusFilter;
    
    const matchesDate = (!codDateFrom || cod.date >= codDateFrom) && 
                       (!codDateTo || cod.date <= codDateTo);
    
    return matchesSearch && matchesStatus && matchesDate;
  });

  const updateBalancePaid = async (date: string, value: number, note?: string, codStatus?: 'PENDING' | 'COMPLETED') => {
    const calendarEntry = calendarData.find(item => item.date === date);
    if (!calendarEntry) {
      toast.error('Calendar entry not found');
      return;
    }

    // If status is COMPLETED and balancePaid > 0, process COD settlement
    const status = codStatus || calendarEntry.codStatus || 'PENDING';
    if (status === 'COMPLETED' && value > 0 && selectedDriver) {
      setIsProcessingCOD(true);
      setCodError(null);

      try {
        const driver = drivers.find(d => d.id === selectedDriver);
        if (!driver || !driver.fleet_id) {
          throw new Error('Driver not found or missing fleet_id');
        }

        // Get merchant vendor ID from calendar entry
        const merchantVendorId = calendarEntry.merchantVendorId || merchantWallets[0]?.vendor_id;
        if (!merchantVendorId) {
          throw new Error('Merchant vendor ID not found');
        }

        // Find COD confirmation for this date to get COD ID
        const codForDate = codConfirmations.find(cod => cod.date === date);
        const codId = codForDate?.id || calendarEntry.codId || `COD-${date}`;

        // Call COD settlement API (new endpoint with wallet update)
        const settlementResult = await settleCOD(
          codId,
          'cash', // Default payment method, can be made configurable
          'system' // User ID, should come from auth context
        );

        if (settlementResult.status === 'success') {
          // Update calendar entry with COMPLETED status
          setCalendarData(prev => prev.map(item => 
            item.date === date 
              ? { 
                  ...item, 
                  balancePaid: value, 
                  note: note || item.note || '', 
                  codStatus: 'COMPLETED',
                  codId: settlementResult.data?.cod?.codId || item.codId
                } 
              : item
          ));
          
          // Refresh merchant wallets to show updated balance
          if (activeTab === 'merchant-wallets') {
            const walletsResult = await fetchCustomerWallets();
            if (walletsResult.status === 'success' && walletsResult.data) {
              setMerchantWallets(walletsResult.data);
            }
          }
          
          toast.success(`COD settled successfully. Wallet updated.`);
          setEditingDate(null);
          setEditingCODStatus(null);
        } else {
          setCodError(settlementResult.message);
          toast.error(`COD settlement failed: ${settlementResult.message}`);
        }
      } catch (error: any) {
        const errorMessage = error.message || 'Failed to process COD settlement';
        setCodError(errorMessage);
        toast.error(`COD settlement error: ${errorMessage}`);
      } finally {
        setIsProcessingCOD(false);
      }
    } else {
      // Just update the calendar data without settlement
      setCalendarData(prev => prev.map(item => 
        item.date === date 
          ? { 
              ...item, 
              balancePaid: value, 
              note: note || item.note || '', 
              codStatus: status 
            } 
          : item
      ));
      setEditingDate(null);
      setEditingCODStatus(null);
    }
  };

  const updateNote = (date: string, note: string) => {
    setCalendarData(prev => prev.map(item => 
      item.date === date ? { ...item, note } : item
    ));
  };

  // Filter calendar data by date range
  const getFilteredCalendarData = () => {
    if (!dateFrom && !dateTo) {
      return calendarData;
    }
    return (calendarData || []).filter(item => {
      const itemDate = item.date;
      const matchesFrom = !dateFrom || itemDate >= dateFrom;
      const matchesTo = !dateTo || itemDate <= dateTo;
      return matchesFrom && matchesTo;
    });
  };

  const filteredCalendarData = getFilteredCalendarData();

  const calculateTotals = () => {
    return filteredCalendarData.reduce((acc, item) => ({
      codReceived: acc.codReceived + item.codReceived,
      codPending: acc.codPending + item.codPending,
      balancePaid: acc.balancePaid + item.balancePaid,
    }), { codReceived: 0, codPending: 0, balancePaid: 0 });
  };

  const totals = calculateTotals();

  // Calculate driver-specific totals with date filtering
  const getDriverTotals = (driverId: string, applyDateFilter: boolean = true) => {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) {
      return {
        manual: 0,
        normal: 0,
        received: 0,
        paid: 0,
        balance: 0
      };
    }
    
    // Get filtered calendar data for this driver (in real app, this would filter by driver)
    const dataToUse = applyDateFilter ? filteredCalendarData : calendarData;
    
    // Calculate totals from filtered calendar data
    const calculatedTotals = dataToUse.reduce((acc, item) => ({
      codReceived: acc.codReceived + item.codReceived,
      codPending: acc.codPending + item.codPending,
      balancePaid: acc.balancePaid + item.balancePaid,
    }), { codReceived: 0, codPending: 0, balancePaid: 0 });
    
    // For single driver, use a portion of totals (in real app, this would be driver-specific)
    const driverPortion = selectedDriver === driverId ? 0.25 : 0.25; // 25% per driver (4 drivers)
    const received = calculatedTotals.codReceived * driverPortion + driver.balance;
    const paid = driver.balance;
    const manual = calculatedTotals.balancePaid * driverPortion * 0.2; // 20% manual
    const normal = calculatedTotals.balancePaid * driverPortion * 0.8; // 80% normal
    
    return {
      manual: manual,
      normal: normal,
      received: received,
      paid: paid,
      balance: driver.pending
    };
  };

  // CSV Export function
  const exportToCSV = () => {
    const currency = localStorage.getItem('currency') || 'BHD';
    const currencySymbol = currency === 'BHD' ? 'BHD' : '$';
    
    let csvContent = '';
    
    if (selectedDriver) {
      // Single driver export
      const driver = drivers.find(d => d.id === selectedDriver);
      const driverTotals = getDriverTotals(selectedDriver, true);
      
      csvContent = `Total COD Balance - ${driver?.name || 'Driver'}\n`;
      if (dateFrom || dateTo) {
        csvContent += `Date Range: ${dateFrom || 'All'} to ${dateTo || 'All'}\n`;
      }
      csvContent += `\n`;
      csvContent += `Driver,${driver?.name || ''}\n`;
      csvContent += `Manual,${currencySymbol} ${driverTotals.manual.toFixed(2)}\n`;
      csvContent += `Normal,${currencySymbol} ${driverTotals.normal.toFixed(2)}\n`;
      csvContent += `Received,${currencySymbol} ${driverTotals.received.toFixed(2)}\n`;
      csvContent += `Paid,${currencySymbol} ${driverTotals.paid.toFixed(2)}\n`;
      csvContent += `Balance,${currencySymbol} ${driverTotals.balance.toFixed(2)}\n`;
    } else {
      // All drivers export
      csvContent = `Total COD Balance - All Drivers\n`;
      if (dateFrom || dateTo) {
        csvContent += `Date Range: ${dateFrom || 'All'} to ${dateTo || 'All'}\n`;
      }
      csvContent += `\n`;
      csvContent += `Driver,Manual,Normal,Received,Paid,Balance\n`;
      
      drivers.forEach(driver => {
        const driverTotals = getDriverTotals(driver.id, true);
        csvContent += `${driver.name},${currencySymbol} ${driverTotals.manual.toFixed(2)},${currencySymbol} ${driverTotals.normal.toFixed(2)},${currencySymbol} ${driverTotals.received.toFixed(2)},${currencySymbol} ${driverTotals.paid.toFixed(2)},${currencySymbol} ${driverTotals.balance.toFixed(2)}\n`;
      });
    }
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `cod-balance-${selectedDriver ? drivers.find(d => d.id === selectedDriver)?.name.replace(' ', '-') : 'all-drivers'}-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-heading text-3xl mb-2">Balance Panel</h1>
        <p className="text-subheading dark:text-[#99BFD1] text-muted-light">Manage COD reconciliation for drivers and merchants</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border dark:border-[#2A3C63]">
        <button
          onClick={() => handleTabChange('reconciliation')}
          className={`px-6 py-3 rounded-t-xl transition-all ${
            activeTab === 'reconciliation'
              ? 'bg-hover-bg-light dark:bg-[#223560] text-[#DE3544] dark:text-[#C1EEFA] border-b-2 border-[#DE3544]'
              : 'text-muted-light dark:text-[#99BFD1] hover:text-[#DE3544] dark:hover:text-[#C1EEFA]'
          }`}
        >
          Reconciliation
        </button>
        {/* COD Confirmation Tab - Hidden from UI but code remains */}
        {/* {showCODSection && (
          <button
            onClick={() => handleTabChange('cod')}
            className={`px-6 py-3 rounded-t-xl transition-all ${
              activeTab === 'cod'
                ? 'bg-hover-bg-light dark:bg-[#223560] text-[#DE3544] dark:text-[#C1EEFA] border-b-2 border-[#DE3544]'
                : 'text-muted-light dark:text-[#99BFD1] hover:text-[#DE3544] dark:hover:text-[#C1EEFA]'
            }`}
          >
            COD Confirmation
          </button>
        )} */}
        {showDriverWalletSection && (
          <button
            onClick={() => handleTabChange('driver-wallets')}
            className={`px-6 py-3 rounded-t-xl transition-all ${
              activeTab === 'driver-wallets'
                ? 'bg-hover-bg-light dark:bg-[#223560] text-[#DE3544] dark:text-[#C1EEFA] border-b-2 border-[#DE3544]'
                : 'text-muted-light dark:text-[#99BFD1] hover:text-[#DE3544] dark:hover:text-[#C1EEFA]'
            }`}
          >
            Driver Wallets
          </button>
        )}
        {showMerchantWalletSection && (
          <button
            onClick={() => handleTabChange('merchant-wallets')}
            className={`px-6 py-3 rounded-t-xl transition-all ${
              activeTab === 'merchant-wallets'
                ? 'bg-hover-bg-light dark:bg-[#223560] text-[#DE3544] dark:text-[#C1EEFA] border-b-2 border-[#DE3544]'
                : 'text-muted-light dark:text-[#99BFD1] hover:text-[#DE3544] dark:hover:text-[#C1EEFA]'
            }`}
          >
            Merchant Wallets
          </button>
        )}
      </div>

      {/* Reconciliation Tab */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-6">
          {/* Top Filters */}
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
            <h3 className="text-heading mb-4">Search Driver</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {/* Unified Driver Search */}
              <div className="md:col-span-2">
                <label className="block text-heading text-sm mb-2">Search by Driver ID, Name, or Phone Number</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="text"
                    placeholder="Enter Driver ID, Name, or Phone Number..."
                    value={unifiedDriverSearch}
                    onChange={(e) => {
                      setUnifiedDriverSearch(e.target.value);
                      setSearchValidation(null);
                      if (!e.target.value.trim()) {
                        setSelectedDriver(null);
                      }
                    }}
                    className={`w-full bg-input-bg dark:bg-[#1A2C53] rounded-xl px-4 py-2.5 pl-10 pr-10 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${
                      searchValidation === 'valid' ? 'border-2 border-green-500' :
                      searchValidation === 'invalid' ? 'border-2 border-[#DE3544]' :
                      'border border-input-border dark:border-[#2A3C63] focus:border-[#DE3544] dark:focus:border-[#C1EEFA]'
                    }`}
                  />
                  {searchValidation === 'valid' && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                  )}
                  {searchValidation === 'invalid' && (
                    <X className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#DE3544]" />
                  )}
                </div>
              </div>

              {/* Search Button */}
              <div className="flex items-end">
                <button
                  onClick={handleSearch}
                  className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all"
                >
                  <Search className="w-5 h-5" />
                  Search
                </button>
              </div>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-heading text-sm mb-2">From Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-heading text-sm mb-2">To Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Validation Message */}
            {searchValidation === 'invalid' && (
              <div className="mt-4 p-3 bg-[#DE3544]/10 border border-[#DE3544]/30 rounded-xl">
                <p className="text-[#DE3544] text-sm">No driver found with the provided information.</p>
              </div>
            )}
            {searchValidation === 'valid' && (
              <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
                <p className="text-green-600 dark:text-green-400 text-sm">Driver found successfully!</p>
              </div>
            )}
          </div>

          {/* Total COD Panel - Dynamic Logic */}
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6 shadow-sm relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-heading text-xl">
                {selectedDriver 
                  ? `Total COD Balance – ${drivers.find(d => d.id === selectedDriver)?.name || 'Driver'}`
                  : 'Total COD Balance – All Drivers'}
              </h3>
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 bg-[#C1EEFA]/10 dark:bg-[#C1EEFA]/10 border border-[#C1EEFA]/30 dark:border-[#C1EEFA]/30 text-[#C1EEFA] rounded-lg hover:bg-[#C1EEFA]/20 dark:hover:bg-[#C1EEFA]/20 transition-all text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
            
            {!selectedDriver ? (
              // Show all drivers table when no filter
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                    <tr>
                      <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver</th>
                      <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Manual</th>
                      <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Normal</th>
                      <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Received</th>
                      <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Paid</th>
                      <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((driver, index) => {
                      const driverTotals = getDriverTotals(driver.id, true);
                      const currency = localStorage.getItem('currency') || 'BHD';
                      const currencySymbol = currency === 'BHD' ? 'BHD' : '$';
                      return (
                        <tr key={driver.id} className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}>
                          <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{driver.name}</td>
                          <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{currencySymbol} {driverTotals.manual.toFixed(2)}</td>
                          <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{currencySymbol} {driverTotals.normal.toFixed(2)}</td>
                          <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{currencySymbol} {driverTotals.received.toFixed(2)}</td>
                          <td className="px-4 py-3 text-green-600 dark:text-green-400 font-semibold">{currencySymbol} {driverTotals.paid.toFixed(2)}</td>
                          <td className="px-4 py-3 text-[#DE3544] dark:text-[#DE3544]">{currencySymbol} {driverTotals.balance.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              // Show single-driver summary
              (() => {
                const driver = drivers.find(d => d.id === selectedDriver);
                const driverTotals = getDriverTotals(selectedDriver, true);
                const currency = localStorage.getItem('currency') || 'BHD';
                const currencySymbol = currency === 'BHD' ? 'BHD' : '$';
                return (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="bg-muted/30 dark:bg-[#1A2C53] rounded-xl p-4 border border-border dark:border-[#2A3C63]">
                      <p className="text-heading dark:text-[#C1EEFA] text-sm mb-1">Manual</p>
                      <p className="text-heading dark:text-white text-2xl font-semibold">{currencySymbol} {driverTotals.manual.toFixed(2)}</p>
                    </div>
                    <div className="bg-muted/30 dark:bg-[#1A2C53] rounded-xl p-4 border border-border dark:border-[#2A3C63]">
                      <p className="text-heading dark:text-[#C1EEFA] text-sm mb-1">Normal</p>
                      <p className="text-heading dark:text-white text-2xl font-semibold">{currencySymbol} {driverTotals.normal.toFixed(2)}</p>
                    </div>
                    <div className="bg-muted/30 dark:bg-[#1A2C53] rounded-xl p-4 border border-border dark:border-[#2A3C63]">
                      <p className="text-heading dark:text-[#C1EEFA] text-sm mb-1">Received</p>
                      <p className="text-heading dark:text-white text-2xl font-semibold">{currencySymbol} {driverTotals.received.toFixed(2)}</p>
                    </div>
                    <div className="bg-muted/30 dark:bg-[#1A2C53] rounded-xl p-4 border border-border dark:border-[#2A3C63]">
                      <p className="text-heading dark:text-[#C1EEFA] text-sm mb-1">Paid</p>
                      <p className="text-green-600 dark:text-green-400 text-2xl font-semibold">{currencySymbol} {driverTotals.paid.toFixed(2)}</p>
                    </div>
                    <div className="bg-muted/30 dark:bg-[#1A2C53] rounded-xl p-4 border border-border dark:border-[#2A3C63]">
                      <p className="text-heading dark:text-[#C1EEFA] text-sm mb-1">Balance</p>
                      <p className="text-[#DE3544] dark:text-[#DE3544] text-2xl font-semibold">{currencySymbol} {driverTotals.balance.toFixed(2)}</p>
                    </div>
                  </div>
                );
              })()
            )}
          </div>

          {/* Calendar Grid */}
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
            <h3 className="text-heading text-xl mb-4">Calendar View</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {filteredCalendarData.map((item) => {
                const isEditing = editingDate === item.date;
                const date = new Date(item.date);
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                const dayNum = date.getDate();

                return (
                  <div
                    key={item.date}
                    className={`bg-muted/30 dark:bg-[#1A2C53] rounded-xl p-4 border border-border dark:border-border transition-all ${
                      isEditing 
                        ? 'border-primary dark:border-[#C1EEFA] shadow-[0_0_16px_rgba(26,44,83,0.2)] dark:shadow-[0_0_16px_rgba(193,238,250,0.3)]' 
                        : 'border-border dark:border-[#2A3C63]'
                    }`}
                  >
                    <div className="text-center mb-3 pb-3 border-b border-border dark:border-[#2A3C63]">
                      <p className="text-muted-light dark:text-[#99BFD1] text-xs">{dayName}</p>
                      <p className="text-heading dark:text-[#C1EEFA] text-2xl font-semibold">{dayNum}</p>
                    </div>

                    <div className="space-y-2">
                      {/* COD Received */}
                      <div>
                        <p className="text-muted-light dark:text-[#99BFD1] text-xs mb-1">COD Received</p>
                        <p className="text-heading dark:text-[#C1EEFA] font-medium">${(item.codReceived || 0).toFixed(2)}</p>
                      </div>

                      {/* Balance Paid (Editable) */}
                      <div>
                        <p className="text-muted-light dark:text-[#99BFD1] text-xs mb-1">Balance Paid</p>
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={item.balancePaid}
                              id={`balance-${item.date}`}
                              className="w-full bg-input-bg dark:bg-[#223560] border border-input-border dark:border-[#C1EEFA] rounded-lg px-2 py-1 text-heading dark:text-[#C1EEFA] text-sm focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA]"
                              autoFocus
                            />
                            {/* COD Status Dropdown */}
                            <select
                              key={`status-${item.date}`}
                              defaultValue={editingCODStatus || item.codStatus || 'PENDING'}
                              onChange={(e) => setEditingCODStatus(e.target.value as 'PENDING' | 'COMPLETED')}
                              id={`status-${item.date}`}
                              className="w-full bg-input-bg dark:bg-[#223560] border border-input-border dark:border-[#C1EEFA] rounded-lg px-2 py-1 text-heading dark:text-[#C1EEFA] text-xs focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA]"
                            >
                              <option value="PENDING">Pending</option>
                              <option value="COMPLETED">Completed</option>
                            </select>
                            <textarea
                              placeholder="Add note for this entry..."
                              defaultValue={item.note || ''}
                              id={`note-${item.date}`}
                              className="w-full bg-input-bg dark:bg-[#223560] border border-input-border dark:border-[#C1EEFA] rounded-lg px-2 py-1 text-heading dark:text-[#C1EEFA] text-xs focus:outline-none focus:border-primary dark:focus:border-[#C1EEFA] resize-none"
                              rows={2}
                            />
                            {codError && (
                              <p className="text-[#DE3544] text-xs">{codError}</p>
                            )}
                            {isProcessingCOD && (
                              <div className="flex items-center gap-2 text-xs text-muted-light dark:text-[#99BFD1]">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Processing COD settlement...
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                          <p className="text-green-600 dark:text-green-400 font-semibold">${(item.balancePaid || 0).toFixed(2)}</p>
                            {item.codStatus && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                item.codStatus === 'COMPLETED' 
                                  ? 'bg-green-500/20 text-green-600 dark:text-green-400' 
                                  : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                              }`}>
                                {item.codStatus}
                              </span>
                            )}
                            {item.note && (
                              <p className="text-muted-light dark:text-[#99BFD1] text-xs mt-1 italic">{item.note}</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* COD Pending */}
                      <div>
                        <p className="text-muted-light dark:text-[#99BFD1] text-xs mb-1">COD Pending</p>
                        <p className="text-[#DE3544] dark:text-[#DE3544] font-medium">${(item.codPending || 0).toFixed(2)}</p>
                      </div>

                      {/* Edit/Save Button */}
                      <button
                        onClick={async () => {
                          if (isEditing) {
                            // Save logic
                            const balanceInput = document.getElementById(`balance-${item.date}`) as HTMLInputElement;
                            const noteInput = document.getElementById(`note-${item.date}`) as HTMLTextAreaElement;
                            const statusSelect = document.getElementById(`status-${item.date}`) as HTMLSelectElement;
                            
                            const newBalance = parseFloat(balanceInput?.value || String(item.balancePaid));
                            const newNote = noteInput?.value || item.note || '';
                            const newStatus = (statusSelect?.value || editingCODStatus || item.codStatus || 'PENDING') as 'PENDING' | 'COMPLETED';
                            
                            await updateBalancePaid(item.date, newBalance, newNote, newStatus);
                          } else {
                            // Enter edit mode
                            setEditingDate(item.date);
                            // Auto-detect status: if balancePaid matches codPending, suggest COMPLETED
                            const suggestedStatus = (item.balancePaid > 0 && Math.abs(item.balancePaid - item.codPending) < 0.01) 
                              ? 'COMPLETED' 
                              : (item.codStatus || 'PENDING');
                            setEditingCODStatus(suggestedStatus);
                            setCodError(null);
                          }
                        }}
                        disabled={isProcessingCOD}
                        className={`w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                          isEditing
                            ? 'bg-primary dark:bg-[#C1EEFA] text-white dark:text-[#1A2C53] hover:shadow-md dark:hover:shadow-[0_0_12px_rgba(193,238,250,0.4)]'
                            : 'bg-primary/10 dark:bg-[#C1EEFA]/10 text-primary dark:text-[#C1EEFA] border border-primary/30 dark:border-[#C1EEFA]/30 hover:bg-primary/20 dark:hover:bg-[#C1EEFA]/20'
                        }`}
                      >
                        {isProcessingCOD ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Save className="w-3 h-3" />
                            {isEditing ? 'Save' : 'Edit'}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* COD Confirmation Tab */}
      {activeTab === 'cod' && (
        <div className="space-y-6">
          {/* Search and Filters */}
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
            <h3 className="text-heading text-xl mb-4">COD Confirmation</h3>
            
            {/* Search Bar */}
            <div className="mb-4">
              <label className="block text-heading text-sm mb-2">Search COD Records</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                <input
                  type="text"
                  placeholder="Search by COD ID, Order ID, Driver, Merchant, or Customer..."
                  value={codSearch}
                  onChange={(e) => setCodSearch(e.target.value)}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
                />
              </div>
            </div>

            {/* Date Range and Status Filter */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-heading text-sm mb-2">From Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="date"
                    value={codDateFrom}
                    onChange={(e) => setCodDateFrom(e.target.value)}
                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-heading text-sm mb-2">To Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="date"
                    value={codDateTo}
                    onChange={(e) => setCodDateTo(e.target.value)}
                    className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl pl-10 pr-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-heading text-sm mb-2">Status Filter</label>
                <select
                  value={codStatusFilter}
                  onChange={(e) => setCodStatusFilter(e.target.value as any)}
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-2.5 text-heading dark:text-[#C1EEFA] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all"
                >
                  <option value="all">All Status</option>
                  <option value="Pending">Pending</option>
                  <option value="Confirmed">Confirmed</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
            </div>
          </div>

          {/* COD Confirmation Table */}
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                  <tr>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">COD ID</th>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Order ID</th>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver</th>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Merchant</th>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Customer</th>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Amount</th>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Date</th>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Status</th>
                    <th className="text-left px-6 py-4 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCODConfirmations.map((cod, index) => (
                    <tr 
                      key={cod.id} 
                      className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''}`}
                    >
                      <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-medium">{cod.id}</td>
                      <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{cod.orderId}</td>
                      <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">
                        <div>
                          <div className="font-medium">{cod.driverName}</div>
                          <div className="text-xs text-muted-light dark:text-[#99BFD1]">{cod.driverId}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{cod.merchant}</td>
                      <td className="px-6 py-4 text-heading dark:text-[#C1EEFA]">{cod.customer}</td>
                      <td className="px-6 py-4 text-heading dark:text-[#C1EEFA] font-semibold">${(cod.amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-4 text-muted-light dark:text-[#99BFD1]">{cod.date}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-lg text-xs font-medium ${
                          cod.status === 'Confirmed' 
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                            : cod.status === 'Pending'
                            ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                          {cod.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {cod.status === 'Pending' && (
                            <>
                              <button
                                onClick={() => setSelectedCod(cod.id)}
                                className="p-2 bg-[#C1EEFA]/10 border border-[#C1EEFA]/30 rounded-lg hover:bg-[#C1EEFA]/20 transition-all group"
                                title="View Details"
                              >
                                <Eye className="w-4 h-4 text-[#C1EEFA] group-hover:scale-110 transition-transform" />
                              </button>
                              <button
                                onClick={() => handleConfirmCOD(cod.id)}
                                className="p-2 bg-green-500/10 border border-green-500/30 rounded-lg hover:bg-green-500/20 transition-all group"
                                title="Confirm COD"
                              >
                                <Check className="w-4 h-4 text-green-400 group-hover:scale-110 transition-transform" />
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedCod(cod.id);
                                  setCodNote('');
                                }}
                                className="p-2 bg-[#DE3544]/10 border border-[#DE3544]/30 rounded-lg hover:bg-[#DE3544]/20 transition-all group"
                                title="Reject COD"
                              >
                                <X className="w-4 h-4 text-[#DE3544] group-hover:scale-110 transition-transform" />
                              </button>
                            </>
                          )}
                          {cod.status !== 'Pending' && cod.notes && (
                            <button
                              onClick={() => {
                                setSelectedCod(cod.id);
                                setCodNote(cod.notes);
                              }}
                              className="p-2 bg-[#C1EEFA]/10 border border-[#C1EEFA]/30 rounded-lg hover:bg-[#C1EEFA]/20 transition-all group"
                              title="View Notes"
                            >
                              <Eye className="w-4 h-4 text-[#C1EEFA] group-hover:scale-110 transition-transform" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {filteredCODConfirmations.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-muted-light dark:text-[#99BFD1]">No COD confirmations found matching your filters.</p>
              </div>
            )}
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
              <p className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total COD Records</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-semibold">{filteredCODConfirmations.length}</p>
            </div>
            <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
              <p className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Pending</p>
              <p className="text-yellow-400 text-2xl font-semibold">
                {filteredCODConfirmations.filter(c => c.status === 'Pending').length}
              </p>
            </div>
            <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
              <p className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Confirmed</p>
              <p className="text-green-400 text-2xl font-semibold">
                {filteredCODConfirmations.filter(c => c.status === 'Confirmed').length}
              </p>
            </div>
            <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
              <p className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Total Amount</p>
              <p className="text-heading dark:text-[#C1EEFA] text-2xl font-semibold">
                ${filteredCODConfirmations.reduce((sum, c) => sum + (c.amount || 0), 0).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* COD Action Modal */}
      {selectedCod && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-heading text-xl">
                {codConfirmations.find(c => c.id === selectedCod)?.status === 'Pending' 
                  ? 'Confirm/Reject COD' 
                  : 'COD Details'}
              </h3>
              <button
                onClick={() => {
                  setSelectedCod(null);
                  setCodNote('');
                }}
                className="p-2 hover:bg-hover-bg-light dark:hover:bg-[#223560] rounded-lg transition-all"
              >
                <X className="w-5 h-5 text-heading dark:text-[#C1EEFA]" />
              </button>
            </div>
            
            {selectedCod && (() => {
              const cod = codConfirmations.find(c => c.id === selectedCod);
              if (!cod) return null;
              
              return (
                <>
                  <div className="space-y-3 mb-4">
                    <div className="flex justify-between">
                      <span className="text-muted-light dark:text-[#99BFD1]">COD ID:</span>
                      <span className="text-heading dark:text-[#C1EEFA] font-medium">{cod.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-light dark:text-[#99BFD1]">Order ID:</span>
                      <span className="text-heading dark:text-[#C1EEFA]">{cod.orderId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-light dark:text-[#99BFD1]">Driver:</span>
                      <span className="text-heading dark:text-[#C1EEFA]">{cod.driverName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-light dark:text-[#99BFD1]">Amount:</span>
                      <span className="text-heading dark:text-[#C1EEFA] font-semibold">${(cod.amount || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-light dark:text-[#99BFD1]">Status:</span>
                      <span className={`px-2 py-1 rounded text-xs ${
                        cod.status === 'Confirmed' 
                          ? 'bg-green-500/20 text-green-400' 
                          : cod.status === 'Pending'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {cod.status}
                      </span>
                    </div>
                  </div>

                  {cod.status === 'Pending' ? (
                    <>
                      <div className="mb-4">
                        <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2">
                          Notes (Optional for confirmation, Required for rejection)
                        </label>
                        <textarea
                          value={codNote}
                          onChange={(e) => setCodNote(e.target.value)}
                          placeholder="Add notes about this COD confirmation..."
                          rows={4}
                          className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] transition-all resize-none"
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleConfirmCOD(selectedCod)}
                          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-all font-medium"
                        >
                          <Check className="w-5 h-5" />
                          Confirm
                        </button>
                        <button
                          onClick={() => handleRejectCOD(selectedCod)}
                          disabled={!codNote.trim()}
                          className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-[#DE3544] text-white rounded-xl hover:bg-[#C92A38] transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <X className="w-5 h-5" />
                          Reject
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {cod.notes && (
                        <div className="mb-4 p-3 bg-muted/30 dark:bg-[#1A2C53] rounded-xl">
                          <p className="text-muted-light dark:text-[#99BFD1] text-sm mb-1">Notes:</p>
                          <p className="text-heading dark:text-[#C1EEFA] text-sm">{cod.notes}</p>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setSelectedCod(null);
                          setCodNote('');
                        }}
                        className="w-full px-6 py-3 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all font-medium"
                      >
                        Close
                      </button>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Driver Wallets Tab */}
      {activeTab === 'driver-wallets' && (
        <div className="space-y-6">
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-[#DE3544]/20 dark:bg-[#DE3544]/20 flex items-center justify-center border border-[#DE3544]/30 dark:border-[#DE3544]/30">
                <Wallet className="w-6 h-6 text-[#DE3544]" />
              </div>
              <div>
                <h3 className="text-heading">Driver Wallets</h3>
                <p className="text-muted-light dark:text-[#99BFD1] text-sm">Search and manage driver balances</p>
              </div>
            </div>

            {/* Driver Search */}
            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-heading text-sm mb-2">Search by ID, Name, or Phone Number</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="text"
                    placeholder="Enter driver ID, name, or phone number..."
                    value={driverWalletSearch}
                    onChange={(e) => {
                      setDriverWalletSearch(e.target.value);
                      setDriverWalletValidation(null);
                    }}
                    className={`w-full bg-input-bg dark:bg-[#1A2C53] rounded-xl px-4 py-2.5 pl-10 pr-10 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${
                      driverWalletValidation === 'valid' ? 'border-2 border-green-500' :
                      driverWalletValidation === 'invalid' ? 'border-2 border-[#DE3544]' :
                      'border border-input-border dark:border-[#2A3C63] focus:border-[#DE3544] dark:focus:border-[#C1EEFA]'
                    }`}
                  />
                  {driverWalletValidation === 'valid' && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                  )}
                  {driverWalletValidation === 'invalid' && (
                    <X className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#DE3544]" />
                  )}
                </div>
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleDriverWalletSearch}
                  className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all"
                >
                  <Search className="w-5 h-5" />
                  Search
                </button>
              </div>
            </div>

            {/* Driver Wallet Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                  <tr>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver ID</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Driver Name</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Current Balance</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Pending COD</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Phone</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((driver, index) => (
                    <tr 
                      key={driver.id} 
                      className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''} ${
                        driverWalletValidation === 'valid' && 
                        (driver.name.toLowerCase().includes(driverWalletSearch.toLowerCase()) ||
                         driver.id.toLowerCase().includes(driverWalletSearch.toLowerCase()) ||
                         driver.phone.includes(driverWalletSearch))
                          ? 'shadow-[0_0_12px_rgba(193,238,250,0.3)] dark:shadow-[0_0_12px_rgba(193,238,250,0.3)]'
                          : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{driver.id}</td>
                      <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{driver.name}</td>
                      <td className="px-4 py-3 text-green-600 dark:text-green-400 font-semibold">${(driver.balance || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-[#DE3544] dark:text-[#DE3544]">${(driver.pending || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-muted-light dark:text-[#99BFD1]">{driver.phone}</td>
                      <td className="px-4 py-3">
                        <button 
                          onClick={() => {
                            setEditingBalance({ type: 'driver', id: driver.id });
                            setNewBalance((driver.balance || 0).toFixed(2));
                            setBalanceNote('');
                          }}
                          className="px-4 py-2 bg-primary/10 dark:bg-[#C1EEFA]/10 border border-primary/30 dark:border-[#C1EEFA]/30 text-primary dark:text-[#C1EEFA] rounded-lg hover:bg-primary/20 dark:hover:bg-[#C1EEFA]/20 transition-all text-sm font-medium"
                        >
                          Edit Balance
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Merchant Wallets Tab */}
      {activeTab === 'merchant-wallets' && (
        <div className="space-y-6">
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-primary/20 dark:bg-[#C1EEFA]/20 flex items-center justify-center border border-primary/30 dark:border-[#C1EEFA]/30">
                <Wallet className="w-6 h-6 text-primary dark:text-[#C1EEFA]" />
              </div>
              <div>
                <h3 className="text-heading">Merchant Wallets</h3>
                <p className="text-muted-light dark:text-[#99BFD1] text-sm">Search and manage merchant balances</p>
              </div>
            </div>

            {/* Merchant Search */}
            <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-heading text-sm mb-2">Search by Merchant ID, Vendor ID, Name, or Phone Number</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                  <input
                    type="text"
                    placeholder="Enter merchant ID (e.g., 89932635), name, or phone..."
                    value={merchantWalletSearch}
                    onChange={(e) => {
                      setMerchantWalletSearch(e.target.value);
                      setMerchantWalletValidation(null);
                    }}
                    className={`w-full bg-input-bg dark:bg-[#1A2C53] rounded-xl px-4 py-2.5 pl-10 pr-10 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none transition-all ${
                      merchantWalletValidation === 'valid' ? 'border-2 border-green-500' :
                      merchantWalletValidation === 'invalid' ? 'border-2 border-[#DE3544]' :
                      'border border-input-border dark:border-[#2A3C63] focus:border-[#DE3544] dark:focus:border-[#C1EEFA]'
                    }`}
                  />
                  {merchantWalletValidation === 'valid' && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                  )}
                  {merchantWalletValidation === 'invalid' && (
                    <X className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#DE3544]" />
                  )}
                </div>
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleMerchantWalletSearch}
                  className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-[#C1EEFA] text-[#1A2C53] rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all"
                >
                  <Search className="w-5 h-5" />
                  Search
                </button>
              </div>
            </div>

            {/* Merchant Wallet Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="table-header-bg dark:bg-[#1A2C53] border-b border-border dark:border-[#2A3C63]">
                  <tr>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Merchant ID</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Vendor ID</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Merchant Name</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Wallet Balance</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Pending COD</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Phone</th>
                    <th className="text-left px-4 py-3 table-header-text dark:text-[#C1EEFA] text-sm font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Show merchantWallets if available, otherwise show merchants */}
                  {(merchantWallets.length > 0 ? merchantWallets : merchants.map(m => ({
                    id: m.id,
                    name: m.name,
                    phone: m.phone || '',
                    balance: m.balance || 0,
                    pending: m.pending || 0,
                    vendor_id: m.vendor_id
                  }))).map((merchant, index) => {
                    const searchTerm = merchantWalletSearch.toLowerCase().trim();
                    const isHighlighted = merchantWalletValidation === 'valid' && (
                      merchant.name.toLowerCase().includes(searchTerm) ||
                      merchant.id.toLowerCase().includes(searchTerm) ||
                      merchant.vendor_id?.toString().includes(searchTerm) ||
                      merchant.phone.includes(merchantWalletSearch)
                    );
                    
                    return (
                      <tr 
                        key={merchant.id} 
                        className={`border-b border-border dark:border-[#2A3C63] hover:bg-table-row-hover dark:hover:bg-[#1A2C53]/50 transition-colors ${index % 2 === 0 ? 'table-zebra dark:bg-[#223560]/20' : ''} ${
                          isHighlighted ? 'shadow-[0_0_12px_rgba(193,238,250,0.3)] dark:shadow-[0_0_12px_rgba(193,238,250,0.3)] bg-[#C1EEFA]/10' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{merchant.id}</td>
                        <td className="px-4 py-3 text-muted-light dark:text-[#99BFD1] font-mono text-sm">{merchant.vendor_id || '-'}</td>
                        <td className="px-4 py-3 text-heading dark:text-[#C1EEFA]">{merchant.name}</td>
                        <td className="px-4 py-3 text-green-600 dark:text-green-400 font-semibold">${(merchant.balance || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-[#DE3544] dark:text-[#DE3544]">${(merchant.pending || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-muted-light dark:text-[#99BFD1]">{merchant.phone}</td>
                        <td className="px-4 py-3">
                          <button 
                            onClick={() => {
                              setEditingBalance({ type: 'merchant', id: merchant.id });
                              setNewBalance((merchant.balance || 0).toFixed(2));
                              setBalanceNote('');
                            }}
                            className="px-4 py-2 bg-primary/10 dark:bg-[#C1EEFA]/10 border border-primary/30 dark:border-[#C1EEFA]/30 text-primary dark:text-[#C1EEFA] rounded-lg hover:bg-primary/20 dark:hover:bg-[#C1EEFA]/20 transition-all text-sm font-medium"
                          >
                            Edit Balance
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              
              {/* Note about API limitation */}
              <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                <p className="text-yellow-600 dark:text-yellow-400 text-sm">
                  <strong>Note:</strong> Due to Tookan API limitations, only the first 100 merchants are displayed. 
                  Use the search box above to find specific merchants by their Merchant ID.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Balance Modal */}
      {editingBalance && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-6 max-w-md w-full shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-heading text-xl">Edit Balance</h3>
              <button
                onClick={() => {
                  setEditingBalance(null);
                  setNewBalance('');
                  setBalanceNote('');
                }}
                className="p-2 hover:bg-hover-bg-light dark:hover:bg-[#223560] rounded-lg transition-all"
              >
                <X className="w-5 h-5 text-heading dark:text-[#C1EEFA]" />
              </button>
            </div>
            
            {editingBalance && (() => {
              const entity = editingBalance.type === 'driver' 
                ? drivers.find(d => d.id === editingBalance.id)
                : merchantWallets.find(m => m.id === editingBalance.id);
              
              if (!entity) return null;
              
              const currentBalance = editingBalance.type === 'driver' 
                ? (entity as Driver).balance || 0
                : (entity as CustomerWallet).balance;
              
              return (
                <div className="space-y-4">
                  <div>
                    <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2">
                      Current Balance
                    </label>
                    <input
                      type="text"
                      value={`$${currentBalance.toFixed(2)}`}
                      disabled
                      className="w-full bg-muted dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] opacity-60 cursor-not-allowed"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2">
                      New Balance
                    </label>
                    <input
                      type="number"
                      value={newBalance}
                      onChange={(e) => setNewBalance(e.target.value)}
                      placeholder="Enter new balance"
                      className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-heading dark:text-[#C1EEFA] text-sm mb-2">
                      Description {editingBalance.type === 'driver' && <span className="text-[#DE3544]">*</span>}
                    </label>
                    <textarea
                      value={balanceNote}
                      onChange={(e) => {
                        setBalanceNote(e.target.value);
                        setWalletError(null);
                      }}
                      placeholder={editingBalance.type === 'driver' 
                        ? "Add description for this transaction (e.g., 'Earnings credit', 'Penalty adjustment')..."
                        : "Add description for this transaction (optional, e.g., 'COD credit', 'Wallet top-up')..."
                      }
                      rows={4}
                      className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-4 py-3 text-heading dark:text-[#C1EEFA] placeholder-[#8F8F8F] dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:shadow-[0_0_12px_rgba(222,53,68,0.3)] dark:focus:shadow-[0_0_12px_rgba(193,238,250,0.3)] transition-all resize-none"
                    />
                    {editingBalance.type === 'driver' && (
                      <p className="text-xs text-muted-light dark:text-[#99BFD1] mt-1">
                        Required: Explain the reason for this transaction
                      </p>
                    )}
                    {editingBalance.type === 'merchant' && (
                      <p className="text-xs text-muted-light dark:text-[#99BFD1] mt-1">
                        Optional: Explain the reason for adding money to the wallet
                      </p>
                    )}
                  </div>

                  {walletError && (
                    <div className="flex items-start gap-2 p-3 bg-[#DE3544]/10 border border-[#DE3544]/30 rounded-xl">
                      <AlertCircle className="w-5 h-5 text-[#DE3544] flex-shrink-0 mt-0.5" />
                      <p className="text-[#DE3544] text-sm">{walletError}</p>
                    </div>
                  )}
                  
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => {
                        setEditingBalance(null);
                        setNewBalance('');
                        setBalanceNote('');
                        setWalletError(null);
                      }}
                      disabled={isProcessingWallet}
                      className="flex-1 bg-muted dark:bg-[#2A3C63] text-heading dark:text-[#C1EEFA] py-3 rounded-xl hover:bg-hover-bg-light dark:hover:bg-[#3A4C73] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!editingBalance) return;
                        
                        const amount = parseFloat(newBalance);
                        if (isNaN(amount) || amount <= 0) {
                          setWalletError('Please enter a valid amount greater than 0');
                          return;
                        }

                        // Description is required for driver operations, optional for customer operations
                        if (editingBalance.type === 'driver' && !balanceNote.trim()) {
                          setWalletError('Please provide a description for this transaction');
                          return;
                        }

                        setIsProcessingWallet(true);
                        setWalletError(null);

                        try {
                          let response: TookanApiResponse;

                          if (editingBalance.type === 'driver') {
                            const driver = drivers.find(d => d.id === editingBalance.id);
                            if (!driver) {
                              throw new Error('Driver not found');
                            }

                            // Determine transaction type based on whether new balance is higher or lower
                            const currentBalance = driver.balance;
                            const difference = amount - currentBalance;
                            
                            if (difference > 0) {
                              // Credit driver wallet
                              response = await createFleetWalletTransaction(
                                driver.fleet_id || driver.id,
                                difference,
                                balanceNote.trim(),
                                'credit'
                              );
                            } else if (difference < 0) {
                              // Debit driver wallet (penalty/adjustment)
                              response = await createFleetWalletTransaction(
                                driver.fleet_id || driver.id,
                                Math.abs(difference),
                                balanceNote.trim(),
                                'debit'
                              );
                            } else {
                              // No change needed
                              setIsProcessingWallet(false);
                              setEditingBalance(null);
                              setNewBalance('');
                              setBalanceNote('');
                              toast.success('No balance change needed');
                              return;
                            }
                          } else {
                            // Merchant wallet
                            const merchant = merchantWallets.find(m => m.id === editingBalance.id);
                            if (!merchant) {
                              throw new Error('Merchant not found');
                            }

                            const currentBalance = merchant.balance;
                            const difference = amount - currentBalance;
                            
                            if (difference > 0) {
                              // Add money to merchant wallet (only addition is supported by Tookan Custom Wallet API)
                              const vendorId = merchant.vendor_id;
                              if (!vendorId) {
                                throw new Error('Merchant vendor ID not found. Cannot process wallet transaction.');
                              }
                              
                              // Description is optional for merchant wallet operations (per API documentation)
                              response = await addCustomerWalletPayment(
                                vendorId,
                                difference,
                                balanceNote.trim() || undefined
                              );
                            } else if (difference < 0) {
                              // Note: Tookan Custom Wallet API typically only supports adding money
                              // For debiting, you may need a different endpoint or workflow
                              setWalletError('Debiting merchant wallet is not supported via this API. To reduce balance, please use the Tookan dashboard directly.');
                              setIsProcessingWallet(false);
                              return;
                            } else {
                              // No change needed
                              setIsProcessingWallet(false);
                              setEditingBalance(null);
                              setNewBalance('');
                              setBalanceNote('');
                              toast.success('No balance change needed');
                              return;
                            }
                          }

                          if (response.status === 'success') {
                            toast.success(response.message);
                            setEditingBalance(null);
                            setNewBalance('');
                            setBalanceNote('');
                            // In a real app, you'd refresh the wallet data here
                            // await refreshWalletData(editingBalance.type, editingBalance.id);
                          } else {
                            setWalletError(response.message);
                            toast.error(response.message);
                          }
                        } catch (error) {
                          const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
                          setWalletError(errorMessage);
                          toast.error(errorMessage);
                        } finally {
                          setIsProcessingWallet(false);
                        }
                      }}
                      disabled={isProcessingWallet}
                      className="flex-1 bg-[#C1EEFA] text-[#1A2C53] py-3 rounded-xl hover:shadow-[0_0_16px_rgba(193,238,250,0.4)] transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isProcessingWallet ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        'Update Balance'
                      )}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}