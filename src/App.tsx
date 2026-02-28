import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { Comment, Order, OrderFile, Profile } from './types';

type Role = Profile['role'];
type NavPage = 'dashboard' | 'clients' | 'reports';
type StatusFilter = 'all' | Order['status'];
type BusinessFilter = 'all' | 'it_services' | 'academic' | 'other';
type SortField = 'updated_at' | 'due_date' | 'priority' | 'created_at';
type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
  order_id?: string;
}

interface OrderFormValues {
  title: string;
  description: string;
  business_type: 'it_services' | 'academic' | 'other' | '';
  currency_code: 'USD' | 'INR' | 'EUR' | 'GBP';
  client_id: string;
  status: Order['status'];
  priority: Order['priority'];
  assigned_to: string;
  due_date: string;
  estimated_budget: string;
  actual_budget: string;
}

const ORDER_STATUSES: Order['status'][] = ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'];
const PRIORITIES: Order['priority'][] = ['low', 'normal', 'high', 'urgent'];
const BUSINESS_TYPES: Array<'it_services' | 'academic' | 'other'> = ['it_services', 'academic', 'other'];
const CURRENCY_OPTIONS: Array<'USD' | 'INR' | 'EUR' | 'GBP'> = ['USD', 'INR', 'EUR', 'GBP'];
const FILE_CATEGORIES: Array<OrderFile['file_category']> = [
  'assignment_brief',
  'code_solution',
  'archive_zip',
  'document',
  'other',
];

const STATUS_LABELS: Record<Order['status'], string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const PRIORITY_LABELS: Record<Order['priority'], string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

const BUSINESS_LABELS: Record<'it_services' | 'academic' | 'other', string> = {
  it_services: 'IT Services',
  academic: 'Academic',
  other: 'Other',
};

const FILE_CATEGORY_LABELS: Record<NonNullable<OrderFile['file_category']>, string> = {
  assignment_brief: 'Assignment Brief',
  code_solution: 'Code Solution',
  archive_zip: 'ZIP Archive',
  document: 'Document',
  other: 'Other',
};

const PAGE_SIZE = 10;

function formatDate(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString();
}

function formatCurrency(value: number | null, currencyCode: string | null = 'USD'): string {
  if (value === null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode || 'USD' }).format(value);
}

function formatBytes(size: number | null): string {
  if (!size || size < 1) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = size;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

type SheetRange = 'weekly' | 'monthly' | 'yearly';

function getRangeStart(range: SheetRange): Date {
  const now = new Date();
  const start = new Date(now);
  if (range === 'weekly') {
    start.setDate(now.getDate() - 7);
  } else if (range === 'monthly') {
    start.setMonth(now.getMonth() - 1);
  } else {
    start.setFullYear(now.getFullYear() - 1);
  }
  return start;
}

function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function initials(name: string | null | undefined, fallback = 'U'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  return `${parts[0][0]}${parts.length > 1 ? parts[1][0] : ''}`.toUpperCase();
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function generateOrderCode(): string {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let rand = '';
  for (let i = 0; i < 4; i += 1) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `ORD-${yyyy}${mm}${dd}-${rand}`;
}

function getBudgetProgress(order: Order): { percent: number; colorClass: string } {
  const est = order.estimated_budget ?? 0;
  const actual = order.actual_budget ?? 0;
  if (est <= 0 || actual < 0) return { percent: 0, colorClass: 'progress-green' };
  const percent = Math.min((actual / est) * 100, 200);
  if (percent >= 100) return { percent, colorClass: 'progress-red' };
  if (percent >= 80) return { percent, colorClass: 'progress-amber' };
  return { percent, colorClass: 'progress-green' };
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [selectedPage, setSelectedPage] = useState<NavPage>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [businessFilter, setBusinessFilter] = useState<BusinessFilter>('all');
  const [sortField, setSortField] = useState<SortField>('updated_at');
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [page, setPage] = useState(1);

  const [showNewModal, setShowNewModal] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const [comments, setComments] = useState<Comment[]>([]);
  const [files, setFiles] = useState<OrderFile[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [statusDraft, setStatusDraft] = useState<Order['status']>('not_started');
  const [commentText, setCommentText] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const [commentFile, setCommentFile] = useState<File | null>(null);
  const [commentFileCategory, setCommentFileCategory] = useState<NonNullable<OrderFile['file_category']>>('document');

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadCategory, setUploadCategory] = useState<NonNullable<OrderFile['file_category']>>('document');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const notificationWrapRef = useRef<HTMLDivElement | null>(null);
  const ordersRef = useRef<Order[]>([]);
  const profilesByIdRef = useRef<Map<string, Profile>>(new Map());
  const knownCommentIdsRef = useRef<Set<string>>(new Set());
  const knownFileIdsRef = useRef<Set<string>>(new Set());
  const orderStatusMapRef = useRef<Map<string, Order['status']>>(new Map());
  const lastCommentSeenAtRef = useRef<string>('');
  const lastFileSeenAtRef = useRef<string>('');

  const isAdminOrStaff = profile?.role === 'admin' || profile?.role === 'staff';

  const selectedOrder = useMemo(
    () => orders.find((o) => o.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const profilesById = useMemo(() => {
    const map = new Map<string, Profile>();
    profiles.forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  const clients = useMemo(() => profiles.filter((p) => p.role === 'client'), [profiles]);
  const staffMembers = useMemo(() => profiles.filter((p) => p.role === 'admin' || p.role === 'staff'), [profiles]);
  const unreadNotificationCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications]
  );

  const stats = useMemo(
    () => ({
      total: orders.length,
      inProgress: orders.filter((o) => o.status === 'in_progress').length,
      completed: orders.filter((o) => o.status === 'completed').length,
      urgent: orders.filter((o) => o.priority === 'urgent').length,
    }),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    let result = [...orders];
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }
    if (businessFilter !== 'all') {
      result = result.filter((o) => o.business_type === businessFilter);
    }
    if (q) {
      result = result.filter((o) => {
        const description = (o.description ?? '').toLowerCase();
        return (
          o.order_code.toLowerCase().includes(q) ||
          o.title.toLowerCase().includes(q) ||
          description.includes(q)
        );
      });
    }

    result.sort((a, b) => {
      if (sortField === 'priority') {
        const rank: Record<Order['priority'], number> = { low: 1, normal: 2, high: 3, urgent: 4 };
        return rank[b.priority] - rank[a.priority];
      }
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      return String(bv).localeCompare(String(av));
    });

    return result;
  }, [orders, statusFilter, businessFilter, debouncedSearch, sortField]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

  function addToast(type: ToastType, message: string): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
  }

  function removeToast(id: string): void {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function pushNotification(title: string, message: string, orderId?: string): void {
    const item: AppNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      message,
      created_at: new Date().toISOString(),
      read: false,
      order_id: orderId,
    };
    setNotifications((prev) => [item, ...prev].slice(0, 50));
  }

  function markAllNotificationsRead(): void {
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
  }

  async function openNotification(item: AppNotification): Promise<void> {
    setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    if (item.order_id) {
      const exists = ordersRef.current.some((order) => order.id === item.order_id);
      if (!exists) {
        const { data } = await supabase.from('orders').select('*').eq('id', item.order_id).single();
        if (data) {
          setOrders((prev) => {
            if (prev.some((order) => order.id === data.id)) return prev;
            return [data as Order, ...prev];
          });
        }
      }
      setSelectedPage('dashboard');
      setSelectedOrderId(item.order_id);
      setSidebarOpen(false);
    }
    setIsNotificationOpen(false);
  }

  function getOrderCode(orderId: string): string {
    const found = ordersRef.current.find((order) => order.id === orderId);
    return found?.order_code ?? orderId.slice(0, 8);
  }

  function handleDownloadSheet(range: SheetRange): void {
    const start = getRangeStart(range);
    const now = new Date();
    const filtered = orders.filter((order) => new Date(order.created_at) >= start);

    if (filtered.length === 0) {
      addToast('info', `No ${range} data to download`);
      return;
    }

    const header = [
      'Order Code',
      'Title',
      'Business Type',
      'Status',
      'Priority',
      'Currency',
      'Estimated Budget',
      'Actual Budget',
      'Due Date',
      'Created At',
      'Client',
      'Assigned To',
    ];

    const rows = filtered.map((order) => [
      order.order_code,
      order.title,
      order.business_type ?? '',
      order.status,
      order.priority,
      order.currency_code ?? 'USD',
      order.estimated_budget?.toString() ?? '',
      order.actual_budget?.toString() ?? '',
      order.due_date ?? '',
      order.created_at,
      order.client_id ? (profilesById.get(order.client_id)?.full_name ?? profilesById.get(order.client_id)?.email ?? '') : '',
      order.assigned_to
        ? (profilesById.get(order.assigned_to)?.full_name ?? profilesById.get(order.assigned_to)?.email ?? '')
        : '',
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvEscape(String(cell))).join(','))
      .join('\n');

    const scope = profile.role === 'client' ? 'my-orders' : 'all-orders';
    const dateTag = now.toISOString().slice(0, 10);
    downloadCsv(`worktrack-${scope}-${range}-${dateTag}.csv`, csv);
    addToast('success', `${range[0].toUpperCase() + range.slice(1)} sheet downloaded`);
  }

  async function loadProfile(currentUser: User): Promise<void> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
    if (error || !data) {
      addToast('error', `Failed to load profile: ${error?.message ?? 'Unknown error'}`);
      return;
    }
    setProfile(data as Profile);
  }

  async function loadProfiles(): Promise<void> {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) {
      addToast('error', `Failed to load profiles: ${error.message}`);
      return;
    }
    setProfiles((data ?? []) as Profile[]);
  }

  async function loadOrders(currentProfile: Profile): Promise<void> {
    setOrdersLoading(true);
    let query = supabase.from('orders').select('*').order('updated_at', { ascending: false });

    if (currentProfile.role === 'client') {
      query = query.eq('client_id', currentProfile.id);
    }

    const { data, error } = await query;
    setOrdersLoading(false);
    if (error) {
      addToast('error', `Failed to load orders: ${error.message}`);
      return;
    }
    setOrders((data ?? []) as Order[]);
  }

  async function loadOrderDetails(orderId: string, currentRole: Role): Promise<void> {
    setDetailsLoading(true);

    let commentsQuery = supabase
      .from('comments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (currentRole === 'client') {
      commentsQuery = commentsQuery.eq('is_internal', false);
    }

    const [commentsResult, filesResult] = await Promise.all([
      commentsQuery,
      supabase.from('order_files').select('*').eq('order_id', orderId).order('created_at', { ascending: false }),
    ]);

    setDetailsLoading(false);

    if (commentsResult.error) {
      addToast('error', `Failed to load comments: ${commentsResult.error.message}`);
    } else {
      setComments((commentsResult.data ?? []) as Comment[]);
    }

    if (filesResult.error) {
      addToast('error', `Failed to load files: ${filesResult.error.message}`);
    } else {
      setFiles((filesResult.data ?? []) as OrderFile[]);
    }
  }

  async function handleSignOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      addToast('error', `Logout failed: ${error.message}`);
      return;
    }
    setProfile(null);
    setOrders([]);
    setSelectedOrderId(null);
    setNotifications([]);
    knownCommentIdsRef.current = new Set();
    knownFileIdsRef.current = new Set();
    orderStatusMapRef.current = new Map();
    lastCommentSeenAtRef.current = '';
    lastFileSeenAtRef.current = '';
  }

  async function handleCreateOrder(values: OrderFormValues): Promise<void> {
    if (!profile) return;

    const payload = {
      order_code: generateOrderCode(),
      title: values.title,
      description: values.description || null,
      business_type: values.business_type,
      currency_code: values.currency_code,
      client_id: values.client_id || null,
      status: values.status,
      priority: values.priority,
      assigned_to: values.assigned_to || null,
      due_date: values.due_date || null,
      estimated_budget: values.estimated_budget ? Number(values.estimated_budget) : null,
      actual_budget: values.actual_budget ? Number(values.actual_budget) : null,
      created_by: profile.id,
    };

    const { error } = await supabase.from('orders').insert(payload);
    if (error) {
      addToast('error', `Could not create order: ${error.message}`);
      return;
    }

    addToast('success', 'Order created successfully');
    setShowNewModal(false);
    await loadOrders(profile);
  }

  async function handleUpdateOrder(order: Order, values: OrderFormValues): Promise<void> {
    if (!profile) return;

    const payload = {
      title: values.title,
      description: values.description || null,
      business_type: values.business_type,
      currency_code: values.currency_code,
      client_id: values.client_id || null,
      status: values.status,
      priority: values.priority,
      assigned_to: values.assigned_to || null,
      due_date: values.due_date || null,
      estimated_budget: values.estimated_budget ? Number(values.estimated_budget) : null,
      actual_budget: values.actual_budget ? Number(values.actual_budget) : null,
    };

    const { error } = await supabase.from('orders').update(payload).eq('id', order.id);
    if (error) {
      addToast('error', `Could not update order: ${error.message}`);
      return;
    }

    addToast('success', 'Order updated successfully');
    setEditingOrder(null);
    await loadOrders(profile);
  }

  async function handlePostComment(): Promise<void> {
    if (!selectedOrder || !profile || (!commentText.trim() && !commentFile)) return;

    let attachmentNote = '';
    if (commentFile) {
      const safeName = commentFile.name.replace(/\s+/g, '-');
      const path = `${selectedOrder.id}/comments/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('order-files').upload(path, commentFile, {
        upsert: false,
        contentType: commentFile.type,
      });
      if (uploadError) {
        addToast('error', `Attachment upload failed: ${uploadError.message}`);
        return;
      }

      const { error: fileInsertError } = await supabase.from('order_files').insert({
        order_id: selectedOrder.id,
        uploaded_by: profile.id,
        file_name: commentFile.name,
        file_size: commentFile.size,
        mime_type: commentFile.type,
        file_category: commentFileCategory,
        storage_path: path,
      });

      if (fileInsertError) {
        addToast('error', `Attachment save failed: ${fileInsertError.message}`);
        return;
      }

      attachmentNote = `\n[Attachment: ${commentFile.name} | ${FILE_CATEGORY_LABELS[commentFileCategory]}]`;
    }

    const payload = {
      order_id: selectedOrder.id,
      author_id: profile.id,
      content: `${commentText.trim() || 'Shared an attachment'}${attachmentNote}`,
      is_internal: isAdminOrStaff ? commentInternal : false,
    };

    const { error } = await supabase.from('comments').insert(payload);
    if (error) {
      addToast('error', `Could not post comment: ${error.message}`);
      return;
    }

    setCommentText('');
    setCommentInternal(false);
    setCommentFile(null);
    setCommentFileCategory('document');
    addToast('success', 'Comment added');
    await loadOrderDetails(selectedOrder.id, profile.role);
  }

  async function uploadOrderFile(file: File, category: NonNullable<OrderFile['file_category']>): Promise<void> {
    if (!selectedOrder || !profile) return;

    setUploading(true);
    setUploadProgress(5);

    const progressTimer = window.setInterval(() => {
      setUploadProgress((prev) => (prev < 90 ? prev + 10 : prev));
    }, 150);

    const safeName = file.name.replace(/\s+/g, '-');
    const path = `${selectedOrder.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from('order-files').upload(path, file, {
      upsert: false,
      contentType: file.type,
    });

    if (uploadError) {
      window.clearInterval(progressTimer);
      setUploading(false);
      setUploadProgress(0);
      addToast('error', `Upload failed: ${uploadError.message}`);
      return;
    }

    const { error: insertError } = await supabase.from('order_files').insert({
      order_id: selectedOrder.id,
      uploaded_by: profile.id,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      file_category: category,
      storage_path: path,
    });

    window.clearInterval(progressTimer);

    if (insertError) {
      setUploading(false);
      setUploadProgress(0);
      addToast('error', `File record failed: ${insertError.message}`);
      return;
    }

    setUploadProgress(100);
    window.setTimeout(() => {
      setUploading(false);
      setUploadProgress(0);
    }, 300);

    addToast('success', 'File uploaded');
    await loadOrderDetails(selectedOrder.id, profile.role);
  }

  async function handleDownloadFile(file: OrderFile): Promise<void> {
    const { data, error } = await supabase.storage.from('order-files').createSignedUrl(file.storage_path, 300);
    if (error || !data?.signedUrl) {
      addToast('error', `Download failed: ${error?.message ?? 'No URL generated'}`);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function handleStatusUpdate(): Promise<void> {
    if (!selectedOrder || !profile) return;
    const { error } = await supabase.from('orders').update({ status: statusDraft }).eq('id', selectedOrder.id);
    if (error) {
      addToast('error', `Status update failed: ${error.message}`);
      return;
    }

    addToast('success', 'Status updated');
    await loadOrders(profile);
    await loadOrderDetails(selectedOrder.id, profile.role);
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      void uploadOrderFile(selectedFile, uploadCategory);
    }
    event.target.value = '';
  }

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        addToast('error', `Session check failed: ${error.message}`);
      }
      if (!mounted) return;
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    };

    void initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (!newSession) {
        setProfile(null);
        setOrders([]);
        setComments([]);
        setFiles([]);
        setSelectedOrderId(null);
        setNotifications([]);
        knownCommentIdsRef.current = new Set();
        knownFileIdsRef.current = new Set();
        orderStatusMapRef.current = new Map();
        lastCommentSeenAtRef.current = '';
        lastFileSeenAtRef.current = '';
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadProfile(user);
  }, [user]);

  useEffect(() => {
    if (!profile) return;
    void Promise.all([loadProfiles(), loadOrders(profile)]);
  }, [profile]);

  useEffect(() => {
    ordersRef.current = orders;
    orderStatusMapRef.current = new Map(orders.map((order) => [order.id, order.status]));
  }, [orders]);

  useEffect(() => {
    profilesByIdRef.current = profilesById;
  }, [profilesById]);

  useEffect(() => {
    if (!isNotificationOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!notificationWrapRef.current) return;
      if (!notificationWrapRef.current.contains(event.target as Node)) {
        setIsNotificationOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isNotificationOpen]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, businessFilter, sortField]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    if (!profile) return;

    const ordersChannel = supabase
      .channel(`orders-realtime-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          const oldRow = payload.old as Partial<Order>;
          const newRow = payload.new as Partial<Order>;
          if (newRow.id && newRow.status) {
            const previousStatus = orderStatusMapRef.current.get(newRow.id) ?? oldRow.status;
            if (previousStatus && previousStatus !== newRow.status) {
              const isClientOwn = profile.role === 'client' ? newRow.client_id === profile.id : true;
              if (isClientOwn) {
                pushNotification(
                  'Order Status Changed',
                  `${getOrderCode(newRow.id)} moved from ${STATUS_LABELS[previousStatus]} to ${STATUS_LABELS[newRow.status]}`,
                  newRow.id
                );
              }
            }
            orderStatusMapRef.current.set(newRow.id, newRow.status);
          }
          if (selectedOrderId && newRow.id === selectedOrderId) {
            void loadOrderDetails(selectedOrderId, profile.role);
          }
        }
        void loadOrders(profile);
      })
      .subscribe();

    const commentsChannel = supabase
      .channel(`comments-realtime-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, (payload) => {
        const row = payload.new as Partial<Comment>;
        if (!row.order_id || !row.id) return;
        if (knownCommentIdsRef.current.has(row.id)) return;
        knownCommentIdsRef.current.add(row.id);
        if (row.author_id === profile.id) return;

        const author = row.author_id ? profilesByIdRef.current.get(row.author_id) : null;
        if (profile.role !== 'client' && author?.role === 'client') {
          pushNotification(
            'Client Message',
            `${author.full_name || author.email} sent a comment on ${getOrderCode(row.order_id)}`,
            row.order_id
          );
        } else {
          pushNotification('New Comment', `New comment added on ${getOrderCode(row.order_id)}`, row.order_id);
        }

        if (selectedOrderId && row.order_id === selectedOrderId) {
          void loadOrderDetails(selectedOrderId, profile.role);
        }
      })
      .subscribe();

    const filesChannel = supabase
      .channel(`files-realtime-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_files' }, (payload) => {
        const row = payload.new as Partial<OrderFile>;
        if (!row.order_id || !row.id) return;
        if (knownFileIdsRef.current.has(row.id)) return;
        knownFileIdsRef.current.add(row.id);
        if (row.uploaded_by === profile.id) return;
        pushNotification(
          'New File Uploaded',
          `${row.file_name ?? 'A file'} was uploaded to ${getOrderCode(row.order_id)}`,
          row.order_id
        );
        if (selectedOrderId && row.order_id === selectedOrderId) {
          void loadOrderDetails(selectedOrderId, profile.role);
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(ordersChannel);
      void supabase.removeChannel(commentsChannel);
      void supabase.removeChannel(filesChannel);
    };
  }, [profile, selectedOrderId]);

  useEffect(() => {
    if (!profile) return;

    let cancelled = false;
    knownCommentIdsRef.current = new Set();
    knownFileIdsRef.current = new Set();
    orderStatusMapRef.current = new Map();
    lastCommentSeenAtRef.current = new Date().toISOString();
    lastFileSeenAtRef.current = new Date().toISOString();

    const seedStatusMap = async () => {
      const { data } = await supabase
        .from('orders')
        .select('id,status')
        .order('updated_at', { ascending: false })
        .limit(300);
      if (!data || cancelled) return;
      const map = new Map<string, Order['status']>();
      data.forEach((row) => map.set(row.id, row.status as Order['status']));
      orderStatusMapRef.current = map;
    };

    const syncEvents = async () => {
      const [ordersResult, commentsResult, filesResult] = await Promise.all([
        supabase.from('orders').select('id,status,client_id').order('updated_at', { ascending: false }).limit(300),
        supabase
          .from('comments')
          .select('id,order_id,author_id,created_at')
          .gt('created_at', lastCommentSeenAtRef.current)
          .order('created_at', { ascending: true })
          .limit(100),
        supabase
          .from('order_files')
          .select('id,order_id,uploaded_by,file_name,created_at')
          .gt('created_at', lastFileSeenAtRef.current)
          .order('created_at', { ascending: true })
          .limit(100),
      ]);

      if (cancelled) return;

      if (!ordersResult.error && ordersResult.data) {
        const currentMap = orderStatusMapRef.current;
        ordersResult.data.forEach((row) => {
          const nextStatus = row.status as Order['status'];
          const prev = currentMap.get(row.id);
          if (prev && prev !== nextStatus) {
            const isClientOwn = profile.role === 'client' ? row.client_id === profile.id : true;
            if (isClientOwn) {
              pushNotification(
                'Order Status Changed',
                `${getOrderCode(row.id)} moved from ${STATUS_LABELS[prev]} to ${STATUS_LABELS[nextStatus]}`,
                row.id
              );
            }
          }
          currentMap.set(row.id, nextStatus);
        });
      }

      if (!commentsResult.error && commentsResult.data) {
        commentsResult.data.forEach((item) => {
          if (knownCommentIdsRef.current.has(item.id)) return;
          knownCommentIdsRef.current.add(item.id);
          if (item.author_id !== profile.id) {
            pushNotification('New Comment', `New comment added on ${getOrderCode(item.order_id)}`, item.order_id);
          }
          if (item.created_at && item.created_at > lastCommentSeenAtRef.current) {
            lastCommentSeenAtRef.current = item.created_at;
          }
        });
      }

      if (!filesResult.error && filesResult.data) {
        filesResult.data.forEach((item) => {
          if (knownFileIdsRef.current.has(item.id)) return;
          knownFileIdsRef.current.add(item.id);
          if (item.uploaded_by !== profile.id) {
            pushNotification(
              'New File Uploaded',
              `${item.file_name ?? 'A file'} was uploaded to ${getOrderCode(item.order_id)}`,
              item.order_id
            );
          }
          if (item.created_at && item.created_at > lastFileSeenAtRef.current) {
            lastFileSeenAtRef.current = item.created_at;
          }
        });
      }
    };

    void seedStatusMap();
    void syncEvents();
    const timer = window.setInterval(() => {
      void syncEvents();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!selectedOrder || !profile) return;
    setStatusDraft(selectedOrder.status);
    void loadOrderDetails(selectedOrder.id, profile.role);
  }, [selectedOrder?.id, profile?.role]);

  if (authLoading) {
    return <div className="screen-center">Loading session...</div>;
  }

  if (!session || !user || !profile) {
    return (
      <>
        <AuthScreen onError={(msg) => addToast('error', msg)} onInfo={(msg) => addToast('info', msg)} />
        <ToastStack toasts={toasts} onClose={removeToast} />
      </>
    );
  }

  const pageTitle = selectedOrder
    ? `Order ${selectedOrder.order_code}`
    : selectedPage === 'dashboard'
      ? 'Dashboard / Orders'
      : selectedPage === 'clients'
        ? 'Clients'
        : 'Reports';

  const activityLog = selectedOrder
    ? [
        ...comments.map((c) => ({
          at: c.created_at,
          text:
            profile.role === 'client'
              ? 'Comment added by Team Member'
              : `Comment added by ${profilesById.get(c.author_id ?? '')?.full_name ?? 'User'}`,
        })),
        ...files.map((f) => ({
          at: f.created_at,
          text: `File uploaded: ${f.file_name}`,
        })),
        { at: selectedOrder.updated_at, text: `Order updated (${STATUS_LABELS[selectedOrder.status]})` },
      ]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 10)
    : [];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">WT</div>
          <div className="brand-text">WorkTrack</div>
        </div>

        <nav className="side-nav">
          <button
            className={`nav-link ${selectedPage === 'dashboard' ? 'active' : ''}`}
            onClick={() => {
              setSelectedPage('dashboard');
              setSelectedOrderId(null);
              setSidebarOpen(false);
            }}
          >
            Dashboard / Orders
          </button>
          {isAdminOrStaff && (
            <>
              <button
                className={`nav-link ${selectedPage === 'clients' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedPage('clients');
                  setSelectedOrderId(null);
                  setSidebarOpen(false);
                }}
              >
                Clients
              </button>
              <button
                className={`nav-link ${selectedPage === 'reports' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedPage('reports');
                  setSelectedOrderId(null);
                  setSidebarOpen(false);
                }}
              >
                Reports
              </button>
            </>
          )}
        </nav>

        <div className="sidebar-user">
          <div className="avatar">{initials(profile.full_name, 'U')}</div>
          <div className="user-meta">
            <strong>{profile.full_name || profile.email}</strong>
            <span>{profile.role}</span>
          </div>
          <button className="logout-btn" onClick={() => void handleSignOut()}>
            Logout
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="hamburger" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle menu">
              Menu
            </button>
            <h1>{pageTitle}</h1>
          </div>
          <div className="topbar-actions">
            {!selectedOrder && selectedPage === 'dashboard' && (
              <div className="search-wrap">
                <input
                  type="text"
                  placeholder="Search by code, title, description"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
                {searchText && (
                  <button className="clear-btn" onClick={() => setSearchText('')} aria-label="Clear search">
                    x
                  </button>
                )}
              </div>
            )}
            {isAdminOrStaff && selectedPage === 'dashboard' && !selectedOrder && (
              <button className="primary-btn" onClick={() => setShowNewModal(true)}>
                New Order
              </button>
            )}
            <div className="notification-wrap" ref={notificationWrapRef}>
              <button
                className="icon-btn"
                aria-label="Notifications"
                onClick={() => setIsNotificationOpen((prev) => !prev)}
              >
                <BellIcon />
                {unreadNotificationCount > 0 && <span className="notif-badge">{unreadNotificationCount}</span>}
              </button>
              {isNotificationOpen && (
                <div className="notification-panel">
                  <div className="notification-head">
                    <strong>Notifications</strong>
                    <button
                      className="link-btn"
                      onClick={markAllNotificationsRead}
                    >
                      Mark all read
                    </button>
                  </div>
                  <div className="notification-list">
                    {notifications.length === 0 && <p className="notification-empty">No notifications yet.</p>}
                    {notifications.map((item) => (
                      <button
                        key={item.id}
                        className={`notification-item ${item.read ? '' : 'unread'}`}
                        onClick={() => void openNotification(item)}
                        title={item.order_id ? 'Open order' : 'Notification'}
                      >
                        <strong>{item.title}</strong>
                        <p>{item.message}</p>
                        <span>{new Date(item.created_at).toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <section className="content-area">
          {!selectedOrder && selectedPage === 'dashboard' && (
            <>
              <div className="stats-grid">
                <StatCard label="Total Orders" value={stats.total} />
                <StatCard label="In Progress" value={stats.inProgress} />
                <StatCard label="Completed" value={stats.completed} />
                <StatCard label="Urgent" value={stats.urgent} />
              </div>

              <div className="panel export-panel">
                <h3>Download Sheets</h3>
                <p>Export your orders by time range.</p>
                <div className="export-actions">
                  <button className="secondary-btn" onClick={() => handleDownloadSheet('weekly')}>
                    Weekly Sheet
                  </button>
                  <button className="secondary-btn" onClick={() => handleDownloadSheet('monthly')}>
                    Monthly Sheet
                  </button>
                  <button className="secondary-btn" onClick={() => handleDownloadSheet('yearly')}>
                    Yearly Sheet
                  </button>
                </div>
              </div>

              <div className="filters-row">
                <div className="chips">
                  <FilterChip active={statusFilter === 'all'} label="All" onClick={() => setStatusFilter('all')} />
                  {ORDER_STATUSES.map((status) => (
                    <FilterChip
                      key={status}
                      active={statusFilter === status}
                      label={STATUS_LABELS[status]}
                      onClick={() => setStatusFilter(status)}
                    />
                  ))}
                </div>

                <select value={businessFilter} onChange={(e) => setBusinessFilter(e.target.value as BusinessFilter)}>
                  <option value="all">All Business Types</option>
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {BUSINESS_LABELS[type]}
                    </option>
                  ))}
                </select>

                <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)}>
                  <option value="updated_at">Updated At</option>
                  <option value="due_date">Due Date</option>
                  <option value="priority">Priority</option>
                  <option value="created_at">Created At</option>
                </select>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order Code</th>
                      <th>Title</th>
                      <th>Business Type</th>
                      <th>Status</th>
                      <th>Priority</th>
                      {profile.role !== 'client' && <th>Assigned To</th>}
                      <th>Due Date</th>
                      <th>Est. Budget</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordersLoading && (
                      <tr>
                        <td colSpan={profile.role !== 'client' ? 9 : 8}>Loading orders...</td>
                      </tr>
                    )}

                    {!ordersLoading && paginatedOrders.length === 0 && (
                      <tr>
                        <td colSpan={profile.role !== 'client' ? 9 : 8}>
                          {debouncedSearch ? `No results for '${debouncedSearch}'` : 'No orders found'}
                        </td>
                      </tr>
                    )}

                    {!ordersLoading &&
                      paginatedOrders.map((order) => {
                        const assigned = order.assigned_to ? profilesById.get(order.assigned_to) : null;
                        return (
                          <tr
                            key={order.id}
                            className="clickable-row"
                            onClick={() => {
                              setSelectedOrderId(order.id);
                              setSidebarOpen(false);
                            }}
                          >
                            <td>
                              <span className="order-code">{order.order_code}</span>
                            </td>
                            <td>
                              <div className="title-cell">
                                <strong>{order.title}</strong>
                                <span>{order.description || '-'}</span>
                              </div>
                            </td>
                            <td>
                              <span className="badge neutral">
                                {order.business_type ? BUSINESS_LABELS[order.business_type] : '-'}
                              </span>
                            </td>
                            <td>
                              <span className={`badge status ${order.status}`}>
                                <span className="dot" />
                                {STATUS_LABELS[order.status]}
                              </span>
                            </td>
                            <td>
                              <span className={`badge priority ${order.priority}`}>{PRIORITY_LABELS[order.priority]}</span>
                            </td>
                            {profile.role !== 'client' && (
                              <td>
                                <div className="person">
                                  <span className="avatar sm">{initials(assigned?.full_name, 'A')}</span>
                                  <span>{assigned?.full_name || assigned?.email || '-'}</span>
                                </div>
                              </td>
                            )}
                            <td className="mono">{formatDate(order.due_date)}</td>
                            <td className="mono">{formatCurrency(order.estimated_budget, order.currency_code)}</td>
                            <td>
                              <div className="actions">
                                {isAdminOrStaff && (
                                  <button
                                    className="icon-btn sm action-btn"
                                    title="Edit"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingOrder(order);
                                    }}
                                  >
                                    Edit
                                  </button>
                                )}
                                <button
                                  className="icon-btn sm action-btn"
                                  title="View"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedOrderId(order.id);
                                  }}
                                >
                                  View
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="pagination">
                <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Prev
                </button>
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const pageNum = idx + 1;
                  return (
                    <button key={pageNum} className={pageNum === page ? 'active' : ''} onClick={() => setPage(pageNum)}>
                      {pageNum}
                    </button>
                  );
                })}
                <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next
                </button>
              </div>
            </>
          )}

          {selectedPage === 'clients' && !selectedOrder && (
            <div className="panel">
              <h2>Clients</h2>
              <p>All client profiles currently in the system.</p>
              <div className="client-list">
                {clients.map((client) => (
                  <div key={client.id} className="client-card">
                    <div className="avatar">{initials(client.full_name, 'C')}</div>
                    <div>
                      <strong>{client.full_name || 'Unnamed Client'}</strong>
                      <p>{client.email}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedPage === 'reports' && !selectedOrder && (
            <div className="panel">
              <h2>Reports</h2>
              <p>Quick operational snapshot.</p>
              <ul className="report-list">
                <li>Open workload: {stats.inProgress + (stats.total - stats.completed - stats.inProgress)} orders</li>
                <li>Completion ratio: {stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : '0%'}</li>
                <li>Urgent queue: {stats.urgent} orders</li>
              </ul>
            </div>
          )}

          {selectedOrder && (
            <div className="detail-layout">
              <div className="detail-main">
                <button
                  className="link-btn"
                  onClick={() => {
                    setSelectedOrderId(null);
                    setComments([]);
                    setFiles([]);
                  }}
                >
                  Back to Orders
                </button>

                <div className="hero-card">
                  <div className="hero-head">
                    <span className="order-code large">{selectedOrder.order_code}</span>
                    <h2>{selectedOrder.title}</h2>
                  </div>
                  <p>{selectedOrder.description || 'No description provided.'}</p>
                  <div className="badge-row">
                    <span className={`badge status ${selectedOrder.status}`}>
                      <span className="dot" />
                      {STATUS_LABELS[selectedOrder.status]}
                    </span>
                    <span className={`badge priority ${selectedOrder.priority}`}>{PRIORITY_LABELS[selectedOrder.priority]}</span>
                    <span className="badge neutral">
                      {selectedOrder.business_type ? BUSINESS_LABELS[selectedOrder.business_type] : '-'}
                    </span>
                  </div>

                  <div className="meta-grid">
                    <MetaCell
                      label="Client"
                      value={
                        selectedOrder.client_id
                          ? (profilesById.get(selectedOrder.client_id)?.full_name ??
                            profilesById.get(selectedOrder.client_id)?.email ??
                            '-')
                          : '-'
                      }
                    />
                    <MetaCell
                      label="Assigned To"
                      value={
                        selectedOrder.assigned_to
                          ? (profilesById.get(selectedOrder.assigned_to)?.full_name ??
                            profilesById.get(selectedOrder.assigned_to)?.email ??
                            '-')
                          : '-'
                      }
                    />
                    <MetaCell label="Due Date" value={formatDate(selectedOrder.due_date)} mono />
                    <MetaCell
                      label="Est. Budget"
                      value={formatCurrency(selectedOrder.estimated_budget, selectedOrder.currency_code)}
                      mono
                    />
                    <MetaCell
                      label="Actual Budget"
                      value={formatCurrency(selectedOrder.actual_budget, selectedOrder.currency_code)}
                      mono
                    />
                    <MetaCell label="Created" value={formatDate(selectedOrder.created_at)} mono />
                  </div>

                  <div className="budget-block">
                    <div className="budget-head">
                      <strong>Budget Progress</strong>
                      <span className="mono">
                        {formatCurrency(selectedOrder.actual_budget, selectedOrder.currency_code)} /{' '}
                        {formatCurrency(selectedOrder.estimated_budget, selectedOrder.currency_code)}
                      </span>
                    </div>
                    {(() => {
                      const progress = getBudgetProgress(selectedOrder);
                      return (
                        <div className="progress-wrap">
                          <div className={`progress-bar ${progress.colorClass}`} style={{ width: `${progress.percent}%` }} />
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="panel">
                  <h3>Files</h3>
                  {detailsLoading ? (
                    <p>Loading files...</p>
                  ) : (
                    <>
                      <div className="file-list">
                        {files.length === 0 && <p>No files uploaded yet.</p>}
                        {files.map((file) => (
                          <div key={file.id} className="file-row">
                            <div>
                              <strong>
                                {iconForFile(file.mime_type)} {file.file_name}
                                {file.file_category ? ` (${FILE_CATEGORY_LABELS[file.file_category]})` : ''}
                              </strong>
                              <p className="mono">
                                {formatBytes(file.file_size)} | {formatDate(file.created_at)}
                              </p>
                            </div>
                            <button className="secondary-btn" onClick={() => void handleDownloadFile(file)}>
                              Download
                            </button>
                          </div>
                        ))}
                      </div>

                      {isAdminOrStaff && (
                        <div
                          className="upload-zone"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const dropped = e.dataTransfer.files?.[0];
                            if (dropped) {
                              void uploadOrderFile(dropped, uploadCategory);
                            }
                          }}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            hidden
                            onChange={onFileInputChange}
                            aria-label="Upload order file"
                          />
                          <select
                            value={uploadCategory}
                            onChange={(e) =>
                              setUploadCategory(e.target.value as NonNullable<OrderFile['file_category']>)
                            }
                          >
                            {FILE_CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {FILE_CATEGORY_LABELS[category]}
                              </option>
                            ))}
                          </select>
                          <p>Drag and drop file here, or</p>
                          <button className="primary-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                            {uploading ? 'Uploading...' : 'Select File'}
                          </button>
                          {uploading && (
                            <div className="upload-progress">
                              <div style={{ width: `${uploadProgress}%` }} />
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="panel">
                  <h3>Comments</h3>
                  {detailsLoading ? (
                    <p>Loading comments...</p>
                  ) : (
                    <div className="comments-list">
                      {comments.length === 0 && <p>No comments yet.</p>}
                      {comments.map((comment) => {
                        const author = comment.author_id ? profilesById.get(comment.author_id) : null;
                        const isClientViewer = profile.role === 'client';
                        const displayName = isClientViewer
                          ? (comment.author_id === profile.id ? 'You' : 'Team Member')
                          : (author?.full_name || author?.email || 'Unknown User');
                        const avatarLabel = isClientViewer
                          ? (comment.author_id === profile.id ? 'Y' : 'TM')
                          : initials(author?.full_name, 'U');
                        return (
                          <div key={comment.id} className={`comment-item ${comment.is_internal ? 'internal' : ''}`}>
                            <div className="avatar sm">{avatarLabel}</div>
                            <div className="comment-body">
                              <div className="comment-meta">
                                <strong>{displayName}</strong>
                                <span>{new Date(comment.created_at).toLocaleString()}</span>
                                {comment.is_internal && <em>INTERNAL</em>}
                              </div>
                              <p>{comment.content}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <form
                    className="comment-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handlePostComment();
                    }}
                  >
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Write a comment..."
                      rows={4}
                    />
                    <div className="comment-actions">
                      <div className="comment-attachments">
                        <label className="secondary-btn file-picker">
                          Attach File
                          <input
                            type="file"
                            hidden
                            onChange={(e) => setCommentFile(e.target.files?.[0] ?? null)}
                          />
                        </label>
                        {commentFile && (
                          <span className="attachment-name">
                            {commentFile.name}
                            <button type="button" className="link-btn" onClick={() => setCommentFile(null)}>
                              Remove
                            </button>
                          </span>
                        )}
                        <select
                          value={commentFileCategory}
                          onChange={(e) =>
                            setCommentFileCategory(e.target.value as NonNullable<OrderFile['file_category']>)
                          }
                        >
                          {FILE_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {FILE_CATEGORY_LABELS[category]}
                            </option>
                          ))}
                        </select>
                      </div>
                      {isAdminOrStaff && (
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={commentInternal}
                            onChange={(e) => setCommentInternal(e.target.checked)}
                          />
                          Internal only
                        </label>
                      )}
                      <button className="primary-btn" type="submit" disabled={!commentText.trim() && !commentFile}>
                        Post
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              <aside className="detail-side">
                <div className="panel quick-card">
                  <h3>Quick Status Change</h3>
                  <select value={statusDraft} onChange={(e) => setStatusDraft(e.target.value as Order['status'])}>
                    {ORDER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary-btn"
                    disabled={!isAdminOrStaff}
                    onClick={() => void handleStatusUpdate()}
                    title={isAdminOrStaff ? 'Update status' : 'Only admin/staff can update'}
                  >
                    Update Status
                  </button>
                </div>

                <div className="panel">
                  <h3>Activity Log</h3>
                  <ul className="activity-list">
                    {activityLog.length === 0 && <li>No recent activity.</li>}
                    {activityLog.map((item, idx) => (
                      <li key={`${item.at}-${idx}`}>
                        <strong>{item.text}</strong>
                        <span>{new Date(item.at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </aside>
            </div>
          )}
        </section>

        {(showNewModal || editingOrder) && (
          <OrderModal
            order={editingOrder}
            clients={clients}
            staffMembers={staffMembers}
            onClose={() => {
              setShowNewModal(false);
              setEditingOrder(null);
            }}
            onSubmit={async (values) => {
              if (editingOrder) {
                await handleUpdateOrder(editingOrder, values);
              } else {
                await handleCreateOrder(values);
              }
            }}
          />
        )}

        <ToastStack toasts={toasts} onClose={removeToast} />
      </main>
    </div>
  );
}

function AuthScreen({ onError, onInfo }: { onError: (message: string) => void; onInfo: (message: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        onError(`Login failed: ${error.message}`);
        return;
      }
      onInfo('Logged in successfully');
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
      },
    });

    setLoading(false);
    if (error) {
      onError(`Signup failed: ${error.message}`);
      return;
    }

    onInfo('Signup successful. Check your email if confirmation is enabled.');
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={(e) => void handleSubmit(e)}>
        <h1>WorkTrack Portal</h1>
        <p>{mode === 'login' ? 'Sign in to continue' : 'Create your account'}</p>

        {mode === 'signup' && (
          <label>
            Full Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              placeholder="Your name"
            />
          </label>
        )}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="********"
          />
        </label>

        <button className="primary-btn" type="submit" disabled={loading}>
          {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Sign Up'}
        </button>

        <button
          className="link-btn"
          type="button"
          onClick={() => setMode((m) => (m === 'login' ? 'signup' : 'login'))}
        >
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Login'}
        </button>
      </form>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

function MetaCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="meta-cell">
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value}</strong>
    </div>
  );
}

function iconForFile(mimeType: string | null): string {
  if (!mimeType) return 'FILE';
  if (mimeType.startsWith('image/')) return 'IMG';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('zip')) return 'ZIP';
  return 'FILE';
}

function BellIcon() {
  return (
    <svg
      className="bell-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M9 17a3 3 0 0 0 6 0" />
    </svg>
  );
}

function ToastStack({ toasts, onClose }: { toasts: ToastMessage[]; onClose: (id: string) => void }) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: (id: string) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onClose(toast.id), 3000);
    return () => window.clearTimeout(timer);
  }, [toast.id, onClose]);

  return (
    <div className={`toast ${toast.type}`}>
      <span>{toast.message}</span>
      <button onClick={() => onClose(toast.id)} aria-label="Dismiss notification"> x </button>
    </div>
  );
}

function OrderModal({
  order,
  clients,
  staffMembers,
  onClose,
  onSubmit,
}: {
  order: Order | null;
  clients: Profile[];
  staffMembers: Profile[];
  onClose: () => void;
  onSubmit: (values: OrderFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<OrderFormValues>({
    title: order?.title ?? '',
    description: order?.description ?? '',
    business_type: order?.business_type ?? '',
    currency_code: order?.currency_code ?? 'USD',
    client_id: order?.client_id ?? '',
    status: order?.status ?? 'not_started',
    priority: order?.priority ?? 'normal',
    assigned_to: order?.assigned_to ?? '',
    due_date: order?.due_date ?? '',
    estimated_budget: order?.estimated_budget?.toString() ?? '',
    actual_budget: order?.actual_budget?.toString() ?? '',
  });

  const [errors, setErrors] = useState<{ title?: string; business_type?: string }>({});
  const [saving, setSaving] = useState(false);

  function handleChange<K extends keyof OrderFormValues>(key: K, value: OrderFormValues[K]): void {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const nextErrors: { title?: string; business_type?: string } = {};

    if (!values.title.trim()) {
      nextErrors.title = 'Title is required';
    }
    if (!values.business_type) {
      nextErrors.business_type = 'Business type is required';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    await onSubmit(values);
    setSaving(false);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{order ? 'Edit Order' : 'New Order'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal"> x </button>
        </div>

        <form className="order-form" onSubmit={(e) => void handleSubmit(e)}>
          <label>
            Title *
            <input
              type="text"
              value={values.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="Order title"
            />
            {errors.title && <small className="error-text">{errors.title}</small>}
          </label>

          <label>
            Description
            <textarea
              rows={4}
              value={values.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Order description"
            />
          </label>

          <label>
            Business Type *
            <select
              value={values.business_type}
              onChange={(e) => handleChange('business_type', e.target.value as OrderFormValues['business_type'])}
            >
              <option value="">Select business type</option>
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BUSINESS_LABELS[type]}
                </option>
              ))}
            </select>
            {errors.business_type && <small className="error-text">{errors.business_type}</small>}
          </label>

          <label>
            Currency
            <select
              value={values.currency_code}
              onChange={(e) => handleChange('currency_code', e.target.value as OrderFormValues['currency_code'])}
            >
              {CURRENCY_OPTIONS.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>

          <label>
            Client
            <select value={values.client_id} onChange={(e) => handleChange('client_id', e.target.value)}>
              <option value="">Unassigned client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name || c.email}
                </option>
              ))}
            </select>
          </label>

          <label>
            Status
            <select value={values.status} onChange={(e) => handleChange('status', e.target.value as Order['status'])}>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <label>
            Priority
            <select value={values.priority} onChange={(e) => handleChange('priority', e.target.value as Order['priority'])}>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </select>
          </label>

          <label>
            Assigned To
            <select value={values.assigned_to} onChange={(e) => handleChange('assigned_to', e.target.value)}>
              <option value="">Unassigned staff</option>
              {staffMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name || member.email}
                </option>
              ))}
            </select>
          </label>

          <label>
            Due Date
            <input type="date" value={values.due_date} onChange={(e) => handleChange('due_date', e.target.value)} />
          </label>

          <label>
            Estimated Budget
            <input
              type="number"
              step="0.01"
              value={values.estimated_budget}
              onChange={(e) => handleChange('estimated_budget', e.target.value)}
              placeholder="0.00"
            />
          </label>

          <label>
            Actual Budget
            <input
              type="number"
              step="0.01"
              value={values.actual_budget}
              onChange={(e) => handleChange('actual_budget', e.target.value)}
              placeholder="0.00"
            />
          </label>

          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? 'Saving...' : order ? 'Update Order' : 'Create Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
