import { registerRootComponent } from 'expo';

// The live-location task must be defined before the app starts (Android may start it on its own).
import './locationTask';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
