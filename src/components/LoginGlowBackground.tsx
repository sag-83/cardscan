import './LoginGlowBackground.css'

/** Full-screen animated glow — login page only. */
export function LoginGlowBackground() {
  return (
    <>
      <div className="login-glow" aria-hidden>
        <div className="login-glow__gradient" />
        <span className="login-glow__orb" />
        <span className="login-glow__orb login-glow__orb--alt" />
      </div>
      <div className="login-glow__veil" aria-hidden />
    </>
  )
}
