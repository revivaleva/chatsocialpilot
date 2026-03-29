
async function main() {
    const resList = await fetch('http://127.0.0.1:3001/internal/kameleo/profiles');
    const dataList = await resList.json() as any;
    const p = dataList.profiles.find((x: any) => x.name === 'SBneder60540');
    if (!p) return console.log('Profile not found');
    console.log('App thinks Profile is:', JSON.stringify(p, null, 2));
    const res = await fetch(`http://localhost:5050/profiles/${p.id}`);
    const profile = await res.json() as any;
    console.log('Kameleo Raw Data (5050):', JSON.stringify({
        id: profile.id,
        name: profile.name,
        storage: profile.storage,
        proxy: profile.proxy
    }, null, 2));
}
main();
