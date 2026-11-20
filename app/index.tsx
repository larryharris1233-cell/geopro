import { Redirect } from 'expo-router';

// Home route: a fresh app open always lands on the Map tab.
export default function Index() {
  return <Redirect href="/map" />;
}
