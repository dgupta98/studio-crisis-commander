import { useParams } from 'react-router-dom'
export default function MovieDetailRoute() {
  const { filmId } = useParams()
  return <div data-testid="route-movie-detail">Movie {filmId}</div>
}
