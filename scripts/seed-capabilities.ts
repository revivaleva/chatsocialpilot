import 'dotenv/config';
import { upsertCapability } from '../src/services/capabilities';

async function main(){
  const caps = [
    { key:'open_profile', title:'Open existing profile', description:'Open browser with existing user-data-dir', params_json: JSON.stringify({profilePath:'string', url:'string?', headless:'boolean?'}), preconds_json: JSON.stringify({os:'windows'}) },
    { key:'navigate', title:'Navigate in context', description:'Navigate an existing browser context to URL', params_json: JSON.stringify({contextId:'string?', url:'string'}), preconds_json: JSON.stringify({needsContext:true}) },
    { key:'click_button', title:'Click a button', description:'Click specified selector', params_json: JSON.stringify({contextId:'string', selectors:'array'}), preconds_json: JSON.stringify({needsContext:true}) },
    { key:'type_text', title:'Type text', description:'Type into a selector', params_json: JSON.stringify({contextId:'string', selector:'string?', text:'string'}), preconds_json: JSON.stringify({needsContext:true}) },
    { key:'remember', title:'Remember key/value', description:'Store a memory entry', params_json: JSON.stringify({key:'string', value:'any', type:'fact|pref|alias'}), preconds_json: JSON.stringify({}) }
  ];
  for (const c of caps) {
    upsertCapability(c as any);
    console.log('seeded', c.key);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });




