import { HeroFold } from '../landing/HeroFold'
import { AgentsFold } from '../landing/AgentsFold'
import { HowItWorksFold } from '../landing/HowItWorksFold'
import { CtaFold } from '../landing/CtaFold'

export default function LandingRoute() {
  return (
    <div data-testid="route-landing" className="min-h-screen bg-paper text-ink">
      <HeroFold />
      <AgentsFold />
      <HowItWorksFold />
      <CtaFold />
    </div>
  )
}
