import { CSSProperties, useEffect, useState } from 'react'
import { getSignedPhotoUrl } from '../lib/supabase'

interface StoredCardImageProps {
  base64?: string
  storagePath?: string
  alt: string
  style?: CSSProperties
  fallback?: React.ReactNode
}

export function StoredCardImage({
  base64,
  storagePath,
  alt,
  style,
  fallback = null,
}: StoredCardImageProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!storagePath || base64) {
      setSignedUrl(null)
      return () => undefined
    }

    void getSignedPhotoUrl(storagePath).then((url) => {
      if (!cancelled) setSignedUrl(url)
    })

    return () => {
      cancelled = true
    }
  }, [base64, storagePath])

  const src = base64 ? `data:image/jpeg;base64,${base64}` : signedUrl
  if (!src) return <>{fallback}</>

  return <img src={src} style={style} alt={alt} />
}
