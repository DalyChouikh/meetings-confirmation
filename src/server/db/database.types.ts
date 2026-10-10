
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "abuse_reports": {
                  Row: {
                    "contact_id": string | null,"id": string,"invitee_id": string | null,"reported_at": string,"workspace_id": string
                  }
                  Insert: {
                    "contact_id"?: string | null,"id"?: string,"invitee_id"?: string | null,"reported_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string | null,"id"?: string,"invitee_id"?: string | null,"reported_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "abuse_reports_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "abuse_reports_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: true
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "abuse_reports_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"attendance_marks": {
                  Row: {
                    "actual": Database["public"]['Enums']["attendance_actual"],"invitee_id": string,"late_minutes": number | null,"marked_at": string,"marked_by": string | null,"meeting_id": string,"workspace_id": string
                  }
                  Insert: {
                    "actual": Database["public"]['Enums']["attendance_actual"],"invitee_id": string,"late_minutes"?: number | null,"marked_at"?: string,"marked_by"?: string | null,"meeting_id": string,"workspace_id": string
                  }
                  Update: {
                    "actual"?: Database["public"]['Enums']["attendance_actual"],"invitee_id"?: string,"late_minutes"?: number | null,"marked_at"?: string,"marked_by"?: string | null,"meeting_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attendance_marks_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: true
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "attendance_marks_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string,"id": string,"is_adhoc": boolean,"unsubscribed_at": string | null,"unsubscribed_via": Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at": string,"user_id": string | null,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"email": string,"full_name": string,"id"?: string,"is_adhoc"?: boolean,"unsubscribed_at"?: string | null,"unsubscribed_via"?: Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at"?: string,"user_id"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string,"id"?: string,"is_adhoc"?: boolean,"unsubscribed_at"?: string | null,"unsubscribed_via"?: Database["public"]['Enums']["unsubscribe_via"] | null,"updated_at"?: string,"user_id"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"google_connections": {
                  Row: {
                    "broken_at": string | null,"broken_reason": string | null,"created_at": string,"google_email": string,"google_sub": string,"granted_scopes": (string)[],"id": string,"refresh_token_encrypted": string,"status": Database["public"]['Enums']["connection_status"],"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "broken_at"?: string | null,"broken_reason"?: string | null,"created_at"?: string,"google_email": string,"google_sub": string,"granted_scopes": (string)[],"id"?: string,"refresh_token_encrypted": string,"status"?: Database["public"]['Enums']["connection_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "broken_at"?: string | null,"broken_reason"?: string | null,"created_at"?: string,"google_email"?: string,"google_sub"?: string,"granted_scopes"?: (string)[],"id"?: string,"refresh_token_encrypted"?: string,"status"?: Database["public"]['Enums']["connection_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"list_contacts": {
                  Row: {
                    "contact_id": string,"created_at": string,"list_id": string,"workspace_id": string
                  }
                  Insert: {
                    "contact_id": string,"created_at"?: string,"list_id": string,"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"list_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "list_contacts_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "list_contacts_list_id_workspace_id_fkey"
      columns: ["list_id","workspace_id"]
isOneToOne: false
      referencedRelation: "lists"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"lists": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lists_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_audience": {
                  Row: {
                    "list_id": string,"meeting_id": string,"workspace_id": string
                  }
                  Insert: {
                    "list_id": string,"meeting_id": string,"workspace_id": string
                  }
                  Update: {
                    "list_id"?: string,"meeting_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_audience_list_id_workspace_id_fkey"
      columns: ["list_id","workspace_id"]
isOneToOne: false
      referencedRelation: "lists"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "meeting_audience_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"meeting_audience_people": {
                  Row: {
                    "contact_id": string,"meeting_id": string,"mode": Database["public"]['Enums']["audience_mode"],"workspace_id": string
                  }
                  Insert: {
                    "contact_id": string,"meeting_id": string,"mode": Database["public"]['Enums']["audience_mode"],"workspace_id": string
                  }
                  Update: {
                    "contact_id"?: string,"meeting_id"?: string,"mode"?: Database["public"]['Enums']["audience_mode"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_audience_people_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "meeting_audience_people_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"meeting_changes": {
                  Row: {
                    "changed_at": string,"changed_by": string | null,"changes": NonNullable<Json>,"id": string,"kind": Database["public"]['Enums']["meeting_change_kind"],"meeting_id": string,"notified": boolean,"workspace_id": string
                  }
                  Insert: {
                    "changed_at"?: string,"changed_by"?: string | null,"changes"?: NonNullable<Json>,"id"?: string,"kind": Database["public"]['Enums']["meeting_change_kind"],"meeting_id": string,"notified": boolean,"workspace_id": string
                  }
                  Update: {
                    "changed_at"?: string,"changed_by"?: string | null,"changes"?: NonNullable<Json>,"id"?: string,"kind"?: Database["public"]['Enums']["meeting_change_kind"],"meeting_id"?: string,"notified"?: boolean,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_changes_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"meeting_invitees": {
                  Row: {
                    "calendar_requested_at": string | null,"calendar_sequence": number,"calendar_state": Database["public"]['Enums']["calendar_state"],"contact_id": string,"email_error": string | null,"email_status": Database["public"]['Enums']["invitee_email_status"],"id": string,"invited_at": string,"meeting_id": string,"sent_at": string | null,"token_hash": string | null,"workspace_id": string
                  }
                  Insert: {
                    "calendar_requested_at"?: string | null,"calendar_sequence"?: number,"calendar_state"?: Database["public"]['Enums']["calendar_state"],"contact_id": string,"email_error"?: string | null,"email_status"?: Database["public"]['Enums']["invitee_email_status"],"id"?: string,"invited_at"?: string,"meeting_id": string,"sent_at"?: string | null,"token_hash"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "calendar_requested_at"?: string | null,"calendar_sequence"?: number,"calendar_state"?: Database["public"]['Enums']["calendar_state"],"contact_id"?: string,"email_error"?: string | null,"email_status"?: Database["public"]['Enums']["invitee_email_status"],"id"?: string,"invited_at"?: string,"meeting_id"?: string,"sent_at"?: string | null,"token_hash"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_invitees_contact_id_workspace_id_fkey"
      columns: ["contact_id","workspace_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["id","workspace_id"]
    },{
      foreignKeyName: "meeting_invitees_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"meetings": {
                  Row: {
                    "agenda_md": string,"cancelled_at": string | null,"comments_enabled": boolean,"created_at": string,"created_by": string | null,"delay_options": (number)[],"duration_minutes": number,"footer_note": string,"gmail_root_message_id": string | null,"gmail_thread_id": string | null,"ics_sequence": number,"ics_uid": string,"id": string,"last_nudged_at": string | null,"last_nudged_count": number | null,"location_mode": Database["public"]['Enums']["location_mode"],"location_text": string,"meeting_url": string,"online_text": string,"reason_required": boolean,"reminder_going_hours": number | null,"reminder_pending_hours": number | null,"response_deadline": string | null,"response_mode": Database["public"]['Enums']["response_mode"],"sent_at": string | null,"starts_at": string | null,"status": Database["public"]['Enums']["meeting_status"],"thread_connection_id": string | null,"timezone": string,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "agenda_md"?: string,"cancelled_at"?: string | null,"comments_enabled": boolean,"created_at"?: string,"created_by"?: string | null,"delay_options"?: (number)[],"duration_minutes": number,"footer_note"?: string,"gmail_root_message_id"?: string | null,"gmail_thread_id"?: string | null,"ics_sequence"?: number,"ics_uid"?: string,"id"?: string,"last_nudged_at"?: string | null,"last_nudged_count"?: number | null,"location_mode"?: Database["public"]['Enums']["location_mode"],"location_text"?: string,"meeting_url"?: string,"online_text"?: string,"reason_required": boolean,"reminder_going_hours"?: number | null,"reminder_pending_hours"?: number | null,"response_deadline"?: string | null,"response_mode": Database["public"]['Enums']["response_mode"],"sent_at"?: string | null,"starts_at"?: string | null,"status"?: Database["public"]['Enums']["meeting_status"],"thread_connection_id"?: string | null,"timezone": string,"title"?: string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "agenda_md"?: string,"cancelled_at"?: string | null,"comments_enabled"?: boolean,"created_at"?: string,"created_by"?: string | null,"delay_options"?: (number)[],"duration_minutes"?: number,"footer_note"?: string,"gmail_root_message_id"?: string | null,"gmail_thread_id"?: string | null,"ics_sequence"?: number,"ics_uid"?: string,"id"?: string,"last_nudged_at"?: string | null,"last_nudged_count"?: number | null,"location_mode"?: Database["public"]['Enums']["location_mode"],"location_text"?: string,"meeting_url"?: string,"online_text"?: string,"reason_required"?: boolean,"reminder_going_hours"?: number | null,"reminder_pending_hours"?: number | null,"response_deadline"?: string | null,"response_mode"?: Database["public"]['Enums']["response_mode"],"sent_at"?: string | null,"starts_at"?: string | null,"status"?: Database["public"]['Enums']["meeting_status"],"thread_connection_id"?: string | null,"timezone"?: string,"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meetings_thread_connection_id_fkey"
      columns: ["thread_connection_id"]
isOneToOne: false
      referencedRelation: "google_connections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"outbox_jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"id": string,"idempotency_key": string,"invitee_id": string | null,"kind": Database["public"]['Enums']["job_kind"],"last_error": string | null,"locked_until": string | null,"meeting_id": string | null,"payload": NonNullable<Json>,"run_after": string,"run_id": string | null,"send_started_at": string | null,"status": Database["public"]['Enums']["job_status"],"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key": string,"invitee_id"?: string | null,"kind": Database["public"]['Enums']["job_kind"],"last_error"?: string | null,"locked_until"?: string | null,"meeting_id"?: string | null,"payload"?: NonNullable<Json>,"run_after"?: string,"run_id"?: string | null,"send_started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"invitee_id"?: string | null,"kind"?: Database["public"]['Enums']["job_kind"],"last_error"?: string | null,"locked_until"?: string | null,"meeting_id"?: string | null,"payload"?: NonNullable<Json>,"run_after"?: string,"run_id"?: string | null,"send_started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbox_jobs_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: false
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbox_jobs_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbox_jobs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"last_workspace_id": string | null,"locale": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"last_workspace_id"?: string | null,"locale"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"last_workspace_id"?: string | null,"locale"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_last_workspace_id_fkey"
      columns: ["last_workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"response_history": {
                  Row: {
                    "after_deadline": boolean,"changed_at": string,"comment": string,"delay_minutes": number | null,"id": number,"invitee_id": string,"meeting_id": string,"reason": string,"response_id": string,"status": Database["public"]['Enums']["response_status"],"workspace_id": string
                  }
                  Insert: {
                    "after_deadline": boolean,"changed_at"?: string,"comment"?: string,"delay_minutes"?: number | null,"id"?: never,"invitee_id": string,"meeting_id": string,"reason"?: string,"response_id": string,"status": Database["public"]['Enums']["response_status"],"workspace_id": string
                  }
                  Update: {
                    "after_deadline"?: boolean,"changed_at"?: string,"comment"?: string,"delay_minutes"?: number | null,"id"?: never,"invitee_id"?: string,"meeting_id"?: string,"reason"?: string,"response_id"?: string,"status"?: Database["public"]['Enums']["response_status"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "response_history_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: false
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "response_history_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "response_history_response_id_fkey"
      columns: ["response_id"]
isOneToOne: false
      referencedRelation: "responses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "response_history_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"responses": {
                  Row: {
                    "after_deadline": boolean,"comment": string,"delay_minutes": number | null,"id": string,"invitee_id": string,"meeting_id": string,"needs_reconfirmation": boolean,"reason": string,"responded_at": string,"status": Database["public"]['Enums']["response_status"],"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "after_deadline"?: boolean,"comment"?: string,"delay_minutes"?: number | null,"id"?: string,"invitee_id": string,"meeting_id": string,"needs_reconfirmation"?: boolean,"reason"?: string,"responded_at"?: string,"status": Database["public"]['Enums']["response_status"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "after_deadline"?: boolean,"comment"?: string,"delay_minutes"?: number | null,"id"?: string,"invitee_id"?: string,"meeting_id"?: string,"needs_reconfirmation"?: boolean,"reason"?: string,"responded_at"?: string,"status"?: Database["public"]['Enums']["response_status"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "responses_invitee_id_fkey"
      columns: ["invitee_id"]
isOneToOne: true
      referencedRelation: "meeting_invitees"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "responses_meeting_id_workspace_id_fkey"
      columns: ["meeting_id","workspace_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id","workspace_id"]
    }
                  ]
                },"send_log": {
                  Row: {
                    "google_sub": string,"id": number,"job_id": string | null,"sent_at": string,"workspace_id": string | null
                  }
                  Insert: {
                    "google_sub": string,"id"?: never,"job_id"?: string | null,"sent_at"?: string,"workspace_id"?: string | null
                  }
                  Update: {
                    "google_sub"?: string,"id"?: never,"job_id"?: string | null,"sent_at"?: string,"workspace_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "send_log_job_fk"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "outbox_jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "send_log_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"sender_leases": {
                  Row: {
                    "google_sub": string,"locked_until": string,"run_id": string
                  }
                  Insert: {
                    "google_sub": string,"locked_until": string,"run_id": string
                  }
                  Update: {
                    "google_sub"?: string,"locked_until"?: string,"run_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"workspace_invites": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"revoked_at": string | null,"role": Database["public"]['Enums']["workspace_role"],"token_hash": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"role": Database["public"]['Enums']["workspace_role"],"token_hash": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"token_hash"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_invites_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspace_roles": {
                  Row: {
                    "can_check_in": boolean,"created_at": string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  Insert: {
                    "can_check_in"?: boolean,"created_at"?: string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "can_check_in"?: boolean,"created_at"?: string,"role"?: Database["public"]['Enums']["workspace_role"],"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_roles_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"default_comments_enabled": boolean,"default_delay_options": (number)[],"default_duration_minutes": number,"default_footer_note": string,"default_meeting_url": string,"default_online_text": string,"default_reason_required": boolean,"default_reminder_going_hours": number | null,"default_reminder_pending_hours": number | null,"default_response_mode": Database["public"]['Enums']["response_mode"],"id": string,"locale": string,"name": string,"sender_connection_id": string | null,"slug": string,"timezone": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"default_comments_enabled"?: boolean,"default_delay_options"?: (number)[],"default_duration_minutes"?: number,"default_footer_note"?: string,"default_meeting_url"?: string,"default_online_text"?: string,"default_reason_required"?: boolean,"default_reminder_going_hours"?: number | null,"default_reminder_pending_hours"?: number | null,"default_response_mode"?: Database["public"]['Enums']["response_mode"],"id"?: string,"locale"?: string,"name": string,"sender_connection_id"?: string | null,"slug": string,"timezone": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"default_comments_enabled"?: boolean,"default_delay_options"?: (number)[],"default_duration_minutes"?: number,"default_footer_note"?: string,"default_meeting_url"?: string,"default_online_text"?: string,"default_reason_required"?: boolean,"default_reminder_going_hours"?: number | null,"default_reminder_pending_hours"?: number | null,"default_response_mode"?: Database["public"]['Enums']["response_mode"],"id"?: string,"locale"?: string,"name"?: string,"sender_connection_id"?: string | null,"slug"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspaces_sender_connection_id_fkey"
      columns: ["sender_connection_id"]
isOneToOne: false
      referencedRelation: "google_connections"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invite":
{ Args: { "p_token_hash": string }; Returns: string
                           },
"add_meeting_people":
{ Args: { "p_meeting": string,"p_people": Json,"p_save_to_roster": boolean }; Returns: Json
                           },
"attendance_details":
{ Args: { "p_after_invitee"?: string,"p_after_meeting"?: string,"p_after_name"?: string,"p_after_starts"?: string,"p_from"?: string,"p_limit"?: number,"p_to"?: string,"p_workspace": string }; Returns: Json
                           },
"attendance_summary":
{ Args: { "p_from"?: string,"p_to"?: string,"p_workspace": string }; Returns: Json
                           },
"bulk_contacts":
{ Args: { "p_action": string,"p_contact_ids": (string)[],"p_list_id"?: string,"p_workspace": string }; Returns: number
                           },
"cancel_meeting":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"change_role":
{ Args: { "p_can_check_in": boolean,"p_role": Database["public"]['Enums']["workspace_role"],"p_user": string,"p_workspace": string }; Returns: undefined
                           },
"check_ip_rate_limit":
{ Args: { "p_action": string,"p_ip": string }; Returns: boolean
                           },
"check_token_rate_limit":
{ Args: { "p_ip": string,"p_token_hash": string }; Returns: boolean
                           },
"consume_invite_email":
{ Args: { "p_workspace": string }; Returns: boolean
                           },
"contact_history":
{ Args: { "p_after_meeting"?: string,"p_after_starts"?: string,"p_contact": string,"p_from"?: string,"p_limit"?: number,"p_to"?: string }; Returns: Json
                           },
"create_invite":
{ Args: { "p_email": string,"p_role": Database["public"]['Enums']["workspace_role"],"p_token_hash": string,"p_workspace": string }; Returns: string
                           },
"create_meeting":
{ Args: { "p_workspace": string }; Returns: string
                           },
"create_workspace":
{ Args: { "p_name": string,"p_slug": string,"p_timezone": string }; Returns: {
              "created_at": string,
"default_comments_enabled": boolean,
"default_delay_options": (number)[],
"default_duration_minutes": number,
"default_footer_note": string,
"default_meeting_url": string,
"default_online_text": string,
"default_reason_required": boolean,
"default_reminder_going_hours": number | null,
"default_reminder_pending_hours": number | null,
"default_response_mode": Database["public"]['Enums']["response_mode"],
"id": string,
"locale": string,
"name": string,
"sender_connection_id": string | null,
"slug": string,
"timezone": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "workspaces"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_cancelled_meeting":
{ Args: { "p_meeting": string }; Returns: undefined
                           },
"delete_workspace":
{ Args: { "p_confirm_name": string,"p_workspace": string }; Returns: undefined
                           },
"disconnect_google_connection":
{ Args: { "p_connection": string }; Returns: Json
                           },
"dispatch_claim":
{ Args: { "p_lease_seconds": number,"p_limit": number,"p_run": string }; Returns: Json
                           },
"dispatch_defer_sender":
{ Args: { "p_connection": string,"p_error": string,"p_run": string,"p_until": string }; Returns: undefined
                           },
"dispatch_finish":
{ Args: { "p_error": string,"p_job": string,"p_outcome": Database["public"]['Enums']["invitee_email_status"],"p_token_hash": string }; Returns: undefined
                           },
"dispatch_mark_broken":
{ Args: { "p_connection": string,"p_reason": string,"p_run": string }; Returns: Json
                           },
"dispatch_release":
{ Args: { "p_run": string }; Returns: undefined
                           },
"dispatch_reserve":
{ Args: { "p_job": string,"p_token_hash"?: string }; Returns: Json
                           },
"dispatch_retry":
{ Args: { "p_error": string,"p_job": string }; Returns: Json
                           },
"dispatch_set_thread":
{ Args: { "p_connection": string,"p_meeting": string,"p_root_message_id": string,"p_thread_id": string }; Returns: undefined
                           },
"dispatch_unclaim":
{ Args: { "p_jobs": (string)[] }; Returns: undefined
                           },
"duplicate_meeting":
{ Args: { "p_meeting": string }; Returns: string
                           },
"edit_sent_meeting":
{ Args: { "p_dry_run"?: boolean,"p_fields": Json,"p_meeting": string,"p_notify"?: boolean }; Returns: Json
                           },
"healthcheck":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"import_contacts":
{ Args: { "p_also_add_to_list"?: string,"p_dry_run": boolean,"p_rows": Json,"p_workspace": string }; Returns: Json
                           },
"invite_preview":
{ Args: { "p_token_hash": string }; Returns: {
              "masked_email": string,"role": Database["public"]['Enums']["workspace_role"],"status": string,"workspace_name": string,"workspace_slug": string
            }[]
                           },
"invites_page":
{ Args: { "p_after_created"?: string,"p_after_id"?: string,"p_limit"?: number,"p_workspace": string }; Returns: Json
                           },
"leave_workspace":
{ Args: { "p_workspace": string }; Returns: undefined
                           },
"list_members":
{ Args: { "p_workspace": string }; Returns: {
              "avatar_url": string,"can_check_in": boolean,"display_name": string,"email": string,"joined_at": string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string
            }[]
                           },
"mark_attendance":
{ Args: { "p_actual"?: Database["public"]['Enums']["attendance_actual"],"p_invitee": string,"p_late_minutes"?: number,"p_meeting": string }; Returns: Json
                           },
"mark_rest_as_declared":
{ Args: { "p_meeting": string }; Returns: number
                           },
"meeting_audience":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"meeting_people":
{ Args: { "p_after_id"?: string,"p_after_name"?: string,"p_filter"?: string,"p_limit"?: number,"p_meeting": string,"p_search"?: string }; Returns: Json
                           },
"meeting_results":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"meetings_page":
{ Args: { "p_after_id"?: string,"p_after_key"?: string,"p_limit"?: number,"p_tab": string,"p_workspace": string }; Returns: Json
                           },
"members_page":
{ Args: { "p_after_id"?: string,"p_after_name"?: string,"p_after_role"?: Database["public"]['Enums']["workspace_role"],"p_limit"?: number,"p_role"?: Database["public"]['Enums']["workspace_role"],"p_workspace": string }; Returns: Json
                           },
"nudge_meeting":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"remove_member":
{ Args: { "p_user": string,"p_workspace": string }; Returns: undefined
                           },
"renew_invite":
{ Args: { "p_invite": string,"p_token_hash": string }; Returns: undefined
                           },
"revoke_invite":
{ Args: { "p_invite": string }; Returns: undefined
                           },
"roster":
{ Args: { "p_workspace": string }; Returns: Json
                           },
"save_google_connection":
{ Args: { "p_google_email": string,"p_google_sub": string,"p_scopes": (string)[],"p_token_encrypted": string,"p_user": string }; Returns: string
                           },
"send_meeting":
{ Args: { "p_meeting": string }; Returns: Json
                           },
"set_contact_lists":
{ Args: { "p_contact": string,"p_list_ids": (string)[] }; Returns: undefined
                           },
"set_meeting_audience":
{ Args: { "p_exclude": (string)[],"p_include": (string)[],"p_list_ids": (string)[],"p_meeting": string }; Returns: undefined
                           },
"set_workspace_sender":
{ Args: { "p_connection": string,"p_workspace": string }; Returns: undefined
                           },
"token_invitee":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"token_request_calendar":
{ Args: { "p_token_hash": string }; Returns: boolean
                           },
"token_resubscribe":
{ Args: { "p_token_hash": string }; Returns: boolean
                           },
"token_submit_response":
{ Args: { "p_comment"?: string,"p_delay_minutes"?: number,"p_reason"?: string,"p_status": Database["public"]['Enums']["response_status"],"p_token_hash": string }; Returns: Json
                           },
"token_unsubscribe":
{ Args: { "p_token_hash": string,"p_via": Database["public"]['Enums']["unsubscribe_via"] }; Returns: boolean
                           },
"transfer_ownership":
{ Args: { "p_confirm_name": string,"p_new_owner": string,"p_workspace": string }; Returns: undefined
                           },
"update_contact":
{ Args: { "p_contact": string,"p_email": string,"p_full_name": string,"p_list_ids": (string)[],"p_workspace": string }; Returns: undefined
                           },
"workspace_sender":
{ Args: { "p_workspace": string }; Returns: Json
                           }
          }
          Enums: {
            "attendance_actual": "present"|"late"|"absent","audience_mode": "include"|"exclude","calendar_state": "none"|"added","connection_status": "active"|"broken","invitee_email_status": "queued"|"sent"|"skipped"|"failed"|"unknown","job_kind": "invite"|"calendar_confirm"|"update"|"cancel"|"reminder","job_status": "pending"|"processing"|"done"|"failed"|"paused","location_mode": "in_person"|"online"|"hybrid","meeting_change_kind": "edit"|"cancel","meeting_status": "draft"|"scheduled"|"cancelled","response_mode": "announcement"|"rsvp"|"attendance","response_status": "attending"|"late"|"absent"|"not_attending","unsubscribe_via": "link"|"report","workspace_role": "owner"|"admin"|"viewer"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "attendance_actual": ["present", "late", "absent"],"audience_mode": ["include", "exclude"],"calendar_state": ["none", "added"],"connection_status": ["active", "broken"],"invitee_email_status": ["queued", "sent", "skipped", "failed", "unknown"],"job_kind": ["invite", "calendar_confirm", "update", "cancel", "reminder"],"job_status": ["pending", "processing", "done", "failed", "paused"],"location_mode": ["in_person", "online", "hybrid"],"meeting_change_kind": ["edit", "cancel"],"meeting_status": ["draft", "scheduled", "cancelled"],"response_mode": ["announcement", "rsvp", "attendance"],"response_status": ["attending", "late", "absent", "not_attending"],"unsubscribe_via": ["link", "report"],"workspace_role": ["owner", "admin", "viewer"]
          }
        }
} as const
