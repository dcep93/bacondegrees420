import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import BaconDegrees420 from './app_x/index.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BaconDegrees420 />
  </StrictMode>,
)
