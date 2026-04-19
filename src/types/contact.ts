export interface Contact {
  id: string
  user_id: string
  name: string
  title: string
  company: string
  email: string
  phone_mobile: string
  phone_work: string
  phone_fax: string
  website: string
  address: string
  city: string
  state: string
  zip: string
  country: string
  notes: string
  user_notes: string
  back_notes: string
  stars: number
  scanned_at: string
  front_image: string
  back_image: string
  front_image_url: string
  back_image_url: string
  sent_to_sheets: boolean
  created_at: string
}

export type Screen = 'scan' | 'contacts' | 'bulk' | 'settings'
