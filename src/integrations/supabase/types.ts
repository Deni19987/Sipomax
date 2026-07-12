export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      campaigns: {
        Row: {
          campaign_type: string
          created_at: string
          created_by: string
          id: string
          reason: string
          recipients: Json
          send_error: string | null
          send_results: Json | null
          sent_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          suggested_message: string
          suggested_send_at: string
          title: string
          updated_at: string
          workshop_id: string | null
        }
        Insert: {
          campaign_type: string
          created_at?: string
          created_by: string
          id?: string
          reason: string
          recipients?: Json
          send_error?: string | null
          send_results?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          suggested_message: string
          suggested_send_at: string
          title: string
          updated_at?: string
          workshop_id?: string | null
        }
        Update: {
          campaign_type?: string
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          recipients?: Json
          send_error?: string | null
          send_results?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          suggested_message?: string
          suggested_send_at?: string
          title?: string
          updated_at?: string
          workshop_id?: string | null
        }
        Relationships: []
      }
      fortnox_connections: {
        Row: {
          access_token: string
          created_at: string
          environment: string
          expires_at: string
          id: string
          refresh_token: string
          refreshing_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          environment?: string
          expires_at: string
          id?: string
          refresh_token: string
          refreshing_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          environment?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          refreshing_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fortnox_refresh_events: {
        Row: {
          attempt: number
          duration_ms: number | null
          error_body: string | null
          error_status: number | null
          finished_at: string | null
          id: number
          old_expires_at: string | null
          outcome: string | null
          started_at: string
          token_fingerprint: string | null
          trigger_reason: string
          user_id: string
        }
        Insert: {
          attempt?: number
          duration_ms?: number | null
          error_body?: string | null
          error_status?: number | null
          finished_at?: string | null
          id?: never
          old_expires_at?: string | null
          outcome?: string | null
          started_at?: string
          token_fingerprint?: string | null
          trigger_reason: string
          user_id: string
        }
        Update: {
          attempt?: number
          duration_ms?: number | null
          error_body?: string | null
          error_status?: number | null
          finished_at?: string | null
          id?: never
          old_expires_at?: string | null
          outcome?: string | null
          started_at?: string
          token_fingerprint?: string | null
          trigger_reason?: string
          user_id?: string
        }
        Relationships: []
      }
      fortnox_customers_cache: {
        Row: {
          address: string | null
          city: string | null
          customer_number: string
          email: string | null
          name: string | null
          org_number: string | null
          phone: string | null
          search_text: string | null
          updated_at: string
          workshop_id: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          customer_number: string
          email?: string | null
          name?: string | null
          org_number?: string | null
          phone?: string | null
          search_text?: string | null
          updated_at?: string
          workshop_id: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          customer_number?: string
          email?: string | null
          name?: string | null
          org_number?: string | null
          phone?: string | null
          search_text?: string | null
          updated_at?: string
          workshop_id?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      fortnox_articles_cache: {
        Row: {
          article_number: string
          description: string | null
          sales_price: number | null
          search_text: string | null
          unit: string | null
          updated_at: string
          vat: number | null
          workshop_id: string
        }
        Insert: {
          article_number: string
          description?: string | null
          sales_price?: number | null
          search_text?: string | null
          unit?: string | null
          updated_at?: string
          vat?: number | null
          workshop_id: string
        }
        Update: {
          article_number?: string
          description?: string | null
          sales_price?: number | null
          search_text?: string | null
          unit?: string | null
          updated_at?: string
          vat?: number | null
          workshop_id?: string
        }
        Relationships: []
      }
      fortnox_cache_meta: {
        Row: {
          kind: string
          synced_at: string | null
          workshop_id: string
        }
        Insert: {
          kind: string
          synced_at?: string | null
          workshop_id: string
        }
        Update: {
          kind?: string
          synced_at?: string | null
          workshop_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          archived_at: string | null
          avg_km_per_month: number | null
          billing_address: string | null
          billing_city: string | null
          billing_postal_code: string | null
          created_at: string
          created_by: string | null
          current_status: Database["public"]["Enums"]["job_status"]
          customer_email: string | null
          customer_name: string
          customer_org_number: string | null
          customer_phone: string | null
          engine_code: string | null
          engine_type: string | null
          fortnox_customer_number: string | null
          fortnox_invoice_id: string | null
          gearbox_type: string | null
          id: string
          identifier_type: string
          initial_price: number | null
          invoice_articles: any | null
          invoice_booked_at: string | null
          invoice_bookkept_at: string | null
          invoice_error: string | null
          invoice_generated_at: string | null
          invoice_pdf_base64: string | null
          invoice_snapshot: Json | null
          invoice_scheduled_at: string | null
          job_token: string
          last_inspection_date: string | null
          last_service_at: string | null
          mileage: number | null
          mileage_at_last_service: number | null
          mileage_recorded_at: string | null
          mileage_source: string | null
          model_year: number | null
          next_inspection_date: string | null
          notes: string | null
          owner_count: number | null
          recommended_service_interval_km: number | null
          recommended_service_interval_months: number | null
          last_chat_sms_at: string | null
          link_sms_sent_at: string | null
          pending_chat_reminder_at: string | null
          registration_number: string
          updated_at: string
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_status: string | null
          vehicle_type: string | null
          vin: string | null
          visma_invoice_id: string | null
          workshop_id: string | null
        }
        Insert: {
          archived_at?: string | null
          avg_km_per_month?: number | null
          billing_address?: string | null
          billing_city?: string | null
          billing_postal_code?: string | null
          created_at?: string
          created_by?: string | null
          current_status?: Database["public"]["Enums"]["job_status"]
          customer_email?: string | null
          customer_name: string
          customer_org_number?: string | null
          customer_phone?: string | null
          engine_code?: string | null
          engine_type?: string | null
          fortnox_customer_number?: string | null
          fortnox_invoice_id?: string | null
          gearbox_type?: string | null
          id?: string
          identifier_type?: string
          initial_price?: number | null
          invoice_articles?: any | null
          invoice_booked_at?: string | null
          invoice_bookkept_at?: string | null
          invoice_error?: string | null
          invoice_generated_at?: string | null
          invoice_pdf_base64?: string | null
          invoice_snapshot?: Json | null
          invoice_scheduled_at?: string | null
          job_token?: string
          last_chat_sms_at?: string | null
          link_sms_sent_at?: string | null
          last_inspection_date?: string | null
          last_service_at?: string | null
          mileage?: number | null
          mileage_at_last_service?: number | null
          mileage_recorded_at?: string | null
          mileage_source?: string | null
          model_year?: number | null
          next_inspection_date?: string | null
          notes?: string | null
          owner_count?: number | null
          pending_chat_reminder_at?: string | null
          recommended_service_interval_km?: number | null
          recommended_service_interval_months?: number | null
          registration_number: string
          updated_at?: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_status?: string | null
          vehicle_type?: string | null
          vin?: string | null
          visma_invoice_id?: string | null
          workshop_id?: string | null
        }
        Update: {
          archived_at?: string | null
          avg_km_per_month?: number | null
          billing_address?: string | null
          billing_city?: string | null
          billing_postal_code?: string | null
          created_at?: string
          created_by?: string | null
          current_status?: Database["public"]["Enums"]["job_status"]
          customer_email?: string | null
          customer_name?: string
          customer_org_number?: string | null
          customer_phone?: string | null
          engine_code?: string | null
          engine_type?: string | null
          fortnox_customer_number?: string | null
          fortnox_invoice_id?: string | null
          gearbox_type?: string | null
          id?: string
          identifier_type?: string
          initial_price?: number | null
          invoice_articles?: any | null
          invoice_booked_at?: string | null
          invoice_bookkept_at?: string | null
          invoice_error?: string | null
          invoice_generated_at?: string | null
          invoice_pdf_base64?: string | null
          invoice_snapshot?: Json | null
          invoice_scheduled_at?: string | null
          job_token?: string
          last_chat_sms_at?: string | null
          link_sms_sent_at?: string | null
          last_inspection_date?: string | null
          last_service_at?: string | null
          mileage?: number | null
          mileage_at_last_service?: number | null
          mileage_recorded_at?: string | null
          mileage_source?: string | null
          model_year?: number | null
          next_inspection_date?: string | null
          notes?: string | null
          owner_count?: number | null
          pending_chat_reminder_at?: string | null
          recommended_service_interval_km?: number | null
          recommended_service_interval_months?: number | null
          registration_number?: string
          updated_at?: string
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_status?: string | null
          vehicle_type?: string | null
          vin?: string | null
          visma_invoice_id?: string | null
          workshop_id?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          job_id: string
          sender_id: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          job_id: string
          sender_id?: string | null
          sender_type: Database["public"]["Enums"]["sender_type"]
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          job_id?: string
          sender_id?: string | null
          sender_type?: Database["public"]["Enums"]["sender_type"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          created_at: string
          created_by: string
          customer_name: string
          customer_phone: string | null
          id: string
          job_id: string | null
          opportunity_type: string
          reason: string
          send_error: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["opportunity_status"]
          suggested_message: string
          suggested_send_at: string
          title: string
          trigger_context: string | null
          trigger_message_ids: string[]
          updated_at: string
          workshop_id: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          customer_name: string
          customer_phone?: string | null
          id?: string
          job_id?: string | null
          opportunity_type: string
          reason: string
          send_error?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["opportunity_status"]
          suggested_message: string
          suggested_send_at: string
          title: string
          trigger_context?: string | null
          trigger_message_ids?: string[]
          updated_at?: string
          workshop_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          customer_name?: string
          customer_phone?: string | null
          id?: string
          job_id?: string | null
          opportunity_type?: string
          reason?: string
          send_error?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["opportunity_status"]
          suggested_message?: string
          suggested_send_at?: string
          title?: string
          trigger_context?: string | null
          trigger_message_ids?: string[]
          updated_at?: string
          workshop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_owner_id: string | null
          campaigns_enabled: boolean
          company_name: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          display_name: string | null
          google_review_url: string | null
          id: string
          impersonating_workshop_id: string | null
          insights_last_seen_at: string
          invoice_provider: string
          notify_desktop_push: boolean
          notify_mobile_push: boolean
          notify_customer_messages: boolean
          notify_quote_responses: boolean
          notify_pending_reminders: boolean
          opportunities_enabled: boolean
          opportunity_prompt_base: string | null
          opportunity_prompt_extra: string | null
          pending_reminder_last_sent_at: string | null
          pickup_sms_enabled: boolean
          pickup_sms_review_enabled: boolean
          pickup_sms_review_message: string | null
          service_metrics: string[] | null
          service_prompt_base: string | null
          service_prompt_extra: string | null
          sms_signature: string | null
          workshop_address: string | null
        }
        Insert: {
          account_owner_id?: string | null
          campaigns_enabled?: boolean
          company_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          display_name?: string | null
          google_review_url?: string | null
          id: string
          impersonating_workshop_id?: string | null
          insights_last_seen_at?: string
          invoice_provider?: string
          notify_desktop_push?: boolean
          notify_mobile_push?: boolean
          notify_customer_messages?: boolean
          notify_quote_responses?: boolean
          notify_pending_reminders?: boolean
          opportunities_enabled?: boolean
          opportunity_prompt_base?: string | null
          opportunity_prompt_extra?: string | null
          pending_reminder_last_sent_at?: string | null
          pickup_sms_enabled?: boolean
          pickup_sms_review_enabled?: boolean
          pickup_sms_review_message?: string | null
          service_metrics?: string[] | null
          service_prompt_base?: string | null
          service_prompt_extra?: string | null
          sms_signature?: string | null
          workshop_address?: string | null
        }
        Update: {
          account_owner_id?: string | null
          campaigns_enabled?: boolean
          company_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          display_name?: string | null
          google_review_url?: string | null
          id?: string
          impersonating_workshop_id?: string | null
          insights_last_seen_at?: string
          invoice_provider?: string
          notify_desktop_push?: boolean
          notify_mobile_push?: boolean
          notify_customer_messages?: boolean
          notify_quote_responses?: boolean
          notify_pending_reminders?: boolean
          opportunities_enabled?: boolean
          opportunity_prompt_base?: string | null
          opportunity_prompt_extra?: string | null
          pending_reminder_last_sent_at?: string | null
          pickup_sms_enabled?: boolean
          pickup_sms_review_enabled?: boolean
          pickup_sms_review_message?: string | null
          service_metrics?: string[] | null
          service_prompt_base?: string | null
          service_prompt_extra?: string | null
          sms_signature?: string | null
          workshop_address?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scandic_bookings: {
        Row: {
          created_at: string
          email: string | null
          id: string
          lead_id: string
          meeting_type: string | null
          name: string | null
          phone: string | null
          question: string | null
          slot_end: string
          slot_start: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          lead_id: string
          meeting_type?: string | null
          name?: string | null
          phone?: string | null
          question?: string | null
          slot_end: string
          slot_start: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          lead_id?: string
          meeting_type?: string | null
          name?: string | null
          phone?: string | null
          question?: string | null
          slot_end?: string
          slot_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "scandic_bookings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "scandic_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      scandic_leads: {
        Row: {
          booking_token: string
          created_at: string
          email: string | null
          id: string
          initial_sent_at: string | null
          last_reminder_kind: string | null
          name: string | null
          opted_out: boolean
          owner_id: string
          phone: string
          question: string | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_token?: string
          created_at?: string
          email?: string | null
          id?: string
          initial_sent_at?: string | null
          last_reminder_kind?: string | null
          name?: string | null
          opted_out?: boolean
          owner_id: string
          phone: string
          question?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_token?: string
          created_at?: string
          email?: string | null
          id?: string
          initial_sent_at?: string | null
          last_reminder_kind?: string | null
          name?: string | null
          opted_out?: boolean
          owner_id?: string
          phone?: string
          question?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      scandic_messages: {
        Row: {
          body: string
          created_at: string
          direction: string
          elks_id: string | null
          id: string
          lead_id: string
          reminder_kind: string | null
        }
        Insert: {
          body: string
          created_at?: string
          direction: string
          elks_id?: string | null
          id?: string
          lead_id: string
          reminder_kind?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          direction?: string
          elks_id?: string | null
          id?: string
          lead_id?: string
          reminder_kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scandic_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "scandic_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      status_update_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          status_update_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          status_update_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          status_update_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_update_attachments_status_update_id_fkey"
            columns: ["status_update_id"]
            isOneToOne: false
            referencedRelation: "status_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      status_updates: {
        Row: {
          approval_state: Database["public"]["Enums"]["approval_state"] | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          job_id: string
          quote_amount: number | null
          requires_approval: boolean
          status: Database["public"]["Enums"]["job_status"]
        }
        Insert: {
          approval_state?: Database["public"]["Enums"]["approval_state"] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          job_id: string
          quote_amount?: number | null
          requires_approval?: boolean
          status: Database["public"]["Enums"]["job_status"]
        }
        Update: {
          approval_state?: Database["public"]["Enums"]["approval_state"] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          job_id?: string
          quote_amount?: number | null
          requires_approval?: boolean
          status?: Database["public"]["Enums"]["job_status"]
        }
        Relationships: [
          {
            foreignKeyName: "status_updates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visma_connections: {
        Row: {
          access_token: string
          company_id: string | null
          created_at: string
          environment: string
          expires_at: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          company_id?: string | null
          created_at?: string
          environment?: string
          expires_at: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          company_id?: string | null
          created_at?: string
          environment?: string
          expires_at?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "workshop" | "admin"
      approval_state: "pending" | "approved" | "rejected"
      campaign_status: "pending" | "approved" | "sent" | "failed" | "dismissed"
      job_status:
        | "car_dropped_off"
        | "started_work"
        | "quote_sent"
        | "quote_approved"
        | "quote_rejected"
        | "in_progress"
        | "job_done"
        | "car_picked_up"
        | "diagnosis_started"
        | "order_received"
      opportunity_status:
        | "pending"
        | "approved"
        | "sent"
        | "failed"
        | "dismissed"
      sender_type: "workshop" | "customer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["workshop", "admin"],
      approval_state: ["pending", "approved", "rejected"],
      campaign_status: ["pending", "approved", "sent", "failed", "dismissed"],
      job_status: [
        "car_dropped_off",
        "started_work",
        "quote_sent",
        "quote_approved",
        "quote_rejected",
        "in_progress",
        "job_done",
        "car_picked_up",
        "diagnosis_started",
      ],
      opportunity_status: [
        "pending",
        "approved",
        "sent",
        "failed",
        "dismissed",
      ],
      sender_type: ["workshop", "customer"],
    },
  },
} as const
