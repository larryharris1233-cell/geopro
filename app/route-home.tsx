import { Redirect } from 'expo-router';
import { useEffect } from 'react';

import { requestRouteHome } from '@/constants/routeHome';

// Deep-link landing for the "Route home" launcher shortcut
// (hammerlaneco://route-home, build #21). Records the request for
// the Map screen, then hands over to the Map tab, whose focus
// handler consumes it: saved home -> truck route + navigation
// starts; no home yet -> a plain prompt to set one first.
export default function RouteHome() {
  useEffect(() => {
    requestRouteHome();
  }, []);
  return <Redirect href="/map" />;
}
