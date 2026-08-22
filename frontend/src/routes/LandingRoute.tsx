import { HeroFold } from '../landing/HeroFold'
import { FinaleFold } from '../landing/FinaleFold'

export default function LandingRoute() {
  return (
    <div data-testid="route-landing" className="min-h-screen bg-paper text-ink">
      <HeroFold />
      <FinaleFold />
    </div>
  )
}
