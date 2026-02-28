export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'staff' | 'client';
  created_at: string;
}

export interface Order {
  id: string;
  order_code: string;
  title: string;
  description: string | null;
  business_type: 'it_services' | 'academic' | 'other' | null;
  status: 'not_started' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  estimated_budget: number | null;
  actual_budget: number | null;
  currency_code: 'USD' | 'INR' | 'EUR' | 'GBP' | null;
  sla_target_hours: number | null;
  escalation_level: 'none' | 'warning' | 'critical';
  escalation_reason: string | null;
  escalated_at: string | null;
  due_date: string | null;
  client_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  order_id: string;
  author_id: string | null;
  content: string;
  is_internal: boolean;
  created_at: string;
}

export interface OrderFile {
  id: string;
  order_id: string;
  uploaded_by: string | null;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  file_category: 'assignment_brief' | 'code_solution' | 'archive_zip' | 'document' | 'other' | null;
  storage_path: string;
  created_at: string;
}
