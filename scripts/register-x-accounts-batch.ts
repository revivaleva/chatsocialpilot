/**
 * 複数のXアカウントデータを一括登録するスクリプト（コンテナ存在確認付き）
 * 
 * データ形式: XID;Xパスワード;旧メールアドレス;旧メールパスワード;2FAコード;Authトークン;ct0
 *           または
 *           XID:Xパスワード:旧メールアドレス:旧メールパスワード:2FAコード:Authトークン:ct0
 * 
 * 使用方法:
 *   npx tsx scripts/register-x-accounts-batch.ts
 * 
 * または、データを引数で指定:
 *   npx tsx scripts/register-x-accounts-batch.ts "<データ行1>" "<データ行2>" ...
 */

import { initDb, run, query } from '../src/drivers/db';

interface XAccountData {
  xId: string;
  xPassword: string;
  twofaCode: string;
  authToken: string;
  ct0: string;
}

interface ContainerInfo {
  id: string;
  name: string;
}

/**
 * コンテナ一覧を取得（Container Browser API経由）
 */
async function fetchContainers(): Promise<ContainerInfo[]> {
  try {
    const port = process.env.DASHBOARD_PORT || '5174';
    const response = await fetch(`http://localhost:${port}/api/containers`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const json = await response.json();
    return json.items || [];
  } catch (e: any) {
    console.error(`⚠ コンテナ一覧の取得に失敗しました: ${e?.message || String(e)}`);
    console.error(`   ダッシュボードサーバーが起動していることを確認してください（http://localhost:${process.env.DASHBOARD_PORT || '5174'}）`);
    return [];
  }
}

/**
 * コンテナID（XID）でコンテナを検索
 */
async function findContainerByXId(xId: string, containers: ContainerInfo[]): Promise<ContainerInfo[]> {
  return containers.filter((c: ContainerInfo) => {
    const name = (c.name || '').trim();
    const id = (c.id || '').trim();
    return name === xId || id === xId;
  });
}

function parseAccountLine(line: string): XAccountData | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  let parts: string[];
  if (trimmed.includes(';')) {
    parts = trimmed.split(';');
  } else if (trimmed.includes(':')) {
    parts = trimmed.split(':');
  } else {
    return null;
  }

  if (parts.length < 7) {
    return null;
  }

  return {
    xId: parts[0],
    xPassword: parts[1],
    twofaCode: parts[4],
    authToken: parts[5],
    ct0: parts[6],
  };
}

function checkExistingAccount(containerId: string): boolean {
  const existing = query<{ id: number }>(
    'SELECT id FROM x_accounts WHERE container_id = ?',
    [containerId]
  );
  return existing && existing.length > 0;
}

async function insertXAccount(
  data: XAccountData,
  containers: ContainerInfo[]
): Promise<{ success: boolean; message: string; skipped: boolean }> {
  const now = Date.now();

  // 既存チェック
  if (checkExistingAccount(data.xId)) {
    return {
      success: false,
      message: `既にx_accountsテーブルに存在します: ${data.xId}`,
      skipped: true,
    };
  }

  // コンテナ存在確認
  const matchingContainers = await findContainerByXId(data.xId, containers);

  if (matchingContainers.length === 0) {
    return {
      success: false,
      message: `❌ コンテナが見つかりません: ${data.xId}`,
      skipped: false,
    };
  }

  if (matchingContainers.length > 1) {
    const containerList = matchingContainers.map(c => `  - ${c.name || c.id} (id: ${c.id})`).join('\n');
    return {
      success: false,
      message: `❌ 複数のコンテナが見つかりました（${matchingContainers.length}件）: ${data.xId}\n${containerList}`,
      skipped: false,
    };
  }

  const container = matchingContainers[0];

  try {
    run(
      `INSERT INTO x_accounts (
        container_id, x_password, twofa_code, auth_token, ct0,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.xId,
        data.xPassword,
        data.twofaCode,
        data.authToken,
        data.ct0,
        now,
        now,
      ]
    );

    return {
      success: true,
      message: `✓ 追加成功: ${data.xId} (コンテナ: ${container.name || container.id})`,
      skipped: false,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `❌ エラー: ${data.xId} - ${e?.message || String(e)}`,
      skipped: false,
    };
  }
}

async function main() {
  // データベース初期化
  initDb({ wal: true });

  // コンテナ一覧を事前取得（パフォーマンス向上のため）
  console.log('🔍 コンテナ一覧を取得中...');
  const containers = await fetchContainers();
  console.log(`✓ ${containers.length}件のコンテナを取得しました\n`);

  // データを定義（引数がある場合は引数から、ない場合はここに定義されたデータを使用）
  const args = process.argv.slice(2);
  let dataLines: string[];

  if (args.length > 0) {
    // 引数からデータを取得
    dataLines = args;
  } else {
    // ここにデータを定義
    dataLines = [
      'astrosynth18312:LQlI5Fd0xV4I4:stefyarteaga7583@outlook.com:LIn855H5:R7MRH65FZ5VWB6KM:d0c53a8359f7c0fe3aa4ba3f4d8addf279ceedcc:77abccc2213d45a3808b18371444011bb2b4aed1756d365a9ce5a1b895ff68c60d37cd34c9892003420eda2edde607a0d46b514eb1918f9041baabd4e0fd078ada81f819d52a72b77bd0b948270266f6',
      'astrosynth23314:Y38STNg9FujfR:angelitaliv2606@outlook.com:neB7glyCOG:3IGYMN7HM4SHRRDM:5e084a28101cf5ad980133dda761d013bed03eb2:1ce4f13696b256fb3020284b96533494729d4cf48345383b2da033bd724cef11d4d464e1303d104689b5d2c7751be321a64a08572a1b271f24772db959d4dd024bd5134f0dd1b14d5e4bc473569475ef',
      'astrosynth23396:mRdX1DsqWk8:leontynkakos5156@outlook.com:rICF1gOcZ2:SJUBXFEAB4YL6HNK:40fd9a3fc0f8ef8ef46012afbb07bf4df3d7874e:7eb42207f03188e1c08fb22677705933e61e9a4415f1bce26653ac0155fd50089f568b995ddae52597653606b6e5b51b6ad96f771db42e4526d85e6135578286480826549510690fa8b0348931a98ec6',
      'astrosynth33383:4unsKkCKUaq1Ca:victorinelac2721@outlook.com:cO512daisY:Q2WCDGDL4BNZLLQE:c615e8151b64b65792c12d49d5f416cfc318b76e:36ef86274f184384656ed5ea03d1fabda3ca9a4827031969f7cafa6c035e14f197041d97b7ba92117d3ee09129353c0aa92ac73a09ff5774f0442058baf8e5e29dde6ed108026a73e0b4b172ac5c1342',
      'astrosynth35362:PDYTtWdOuGhFQJ:shizumarcigi9106@outlook.com:divide902T:QX6MSTZGI6WJQQH5:26fdd79769c15024a1520b1bc6a3a41f3124a2c8:bec8110f69fb56571334f6901e8510d59dc249c3cfa143cd5e5f6d7ac20f463527d106723be75e26fe5ef5f78d93cf080dea9410d79ed58886ca83441c1d9bb6705665ad20fc37387bf41ad53855c607',
      'astrosynth42751:G3FR8dtKwNNl:allymollicar4357@outlook.com:Fashiong19:7CZKXPMM6ZJ3ZIHZ:e400820d981278f64069173e2560a3feacbfffb5:2315ccd51faba8be3c7920502352558a40b591e657db4992fce9644c0cddd412aaf32cc48a25e7fae5d7d0be4493718239dfd3f8dc0ee0c33c5898a7bc647867f9b9456916020591645ffab8a5f73794',
      'astrosynth55496:dtY64W96Okvd:dorothealill7396@outlook.com:UnDaD9O12:BBTLMHYTT6TNO3ZX:cce7ec073b0c042f6c065d32145716690f2bc77d:8210b0f6f60b3608fdbe8f48811d23d27b56820d61bf106987ef19fc7bc7d2f44238ca567f46c39e2614cb1ae7436140b57cbbefda4bddbf948e16d80b4c259e1574ad7f83a7a1d7cd3966b93985012c',
      'astrosynth55877:VTf67ubari:nicolettekno1650@outlook.com:ctaeSd3665:7PFE5FL5HS3RZVUK:0109ba66f976578847a612002a269cdc7dd9a1c3:221a568a7f5485ea3265f5454da3116bffbd598345c28bde84cd72997bac54c00e28e522f437136fd9d7a434f3c24384e5c626c146bdf4fe9599deff23eddb8612668cdd6dbc6673a3c14671d4dc7108',
      'astrosynth70596:daR86jEP7xbjd:ofeliazeehar7183@outlook.com:Quick76aV:PLZYQOOKY2QUOXVF:9b89a4e23493c3dfe060be13a2365049cffa144e:481f3038af4bf199d0732d1bf4d9c3d60dc7ea4d94b1ce7b8219a61465015c25b801ec47bc3b1c54ace6deb6540f0023a04f5cd9622ad96309b62feb4614a8c13fd35e38574b89dabe7b934e709dba2c',
      'astrosynth74515:XpkaAM3XFl:hikarivanesk6804@outlook.com:ieNtwll01:7CFAYVYZHBJ2EUEF:f0eafee571a75246dafd747308991ff3d4d19cc2:63b102df62b661433f1273735a50c0ca82b724fe7ac78e651b8ed191adae6b4114f7e3a356bd533995c5c0315eda9c46cae54fea5e256ff4a0875b57d4d36ded0f97403e15d3456bd5255a54489cb395',
      'astrosynth83495:5YeSEjb1Jr1y:fannycindi2393@outlook.com:atoRuforce:WWUN3ZFC5ENNYVEC:9bd57920421409def3c1655ce9eff21e1be1dbb4:db5b2b010c0a403673ed014e1ed76107f5a1a0571c44ff4994180f2aef6680709742964924c250a8b41c0b0c68ef39a304f16c70aeb33ccb89ed17eca78eb0c4ad0dfef00c67fd22c13183f793ff4d4f',
      'astrosynth83555:8XZBOOLpxc:ilhamelaurie6926@outlook.com:iP5sunny7:EWJKFJ5QYSN255Q4:b5d8dd9d766a35130ad51f0075f7105d097ecf5f:0632f2e13634074f15ca5fcd374a191e1a39154169494429e87d9c93583f2b45b10521bdaee04c19dd3552ed2fa42de69b59a19bb7dd03d1d287758035e004282784d339dc3da72ad75302fb0d4416cc',
      'astrosynth84974:lzSeKH4RXT8aq:aurora5300marina@outlook.com:perwmh2003:25VNKCZNI2745LPS:b737fe19ea9bbf552d836dde2a1eacc387825648:e8be9eb8b368321e02ec5ccaf81a541ebb6e060dfa923acc1ffb035a041419eecf2969c16179a4c90983de6c82b59bc9d6a999f09a1c488c95cbdd144f76d160f38975c2b2e36fc8cbed1de38648ecda',
      'astrosynth87208:bwKcBmIxnDX9:milunkajoane5021@outlook.com:e280sAib:ANSHBYEWJMQ5JT3E:48260176224bab452d366f1476d9405982e09879:7f45c786f0385db9786c895d93aced96361e2090eee9dc5b8856f1907e50a3bebd3c8b20c2b968a581e41af6dc6f9631fd2b364535b671caeb8d188c6415bcdcec4c6ad1048175dd0fb9b3e020ed3e1f',
      'astrosynth88236:BS5r9PU9PGy4e:anettbrunild6804@outlook.com:ezUSwieTen:45HWBTKWK75GTT7S:cb4465154f68b1a130777a37b6498007773d77a7:8511f8f1046c163e173f285d3cca0edb4e01f0882618a492f17ff3c30c71063c36cea090a23d7ac05c0ee397646d00d6dc198667d478383af3b98e9b7b329cb9eb9b6b4ed63ae813647a799717981853',
      'astrosynth92264:BNDZCtNOV4fV:fidancaterin6752@outlook.com:RL1rEcent6:UFQIJEAC6R7BPYQH:a610388c6f7861eb83c16e3a34c9dadaf2f984f4:1ab57261a069b1592770fc6e548aa1230b42711751fe009c2d986992fbc7326d166a8475dcf399e3fa26a883b8f6563631b455e30ce0853b7c746812f7ef299d3d07410f9a2c38b381d5672ddf7b1c00',
      'astrosynth92728:CSxMGADM29wH7:ulianachloeg7256@outlook.com:roOlI2208:UK72OZRB6EIK7RPM:51ba7cef1e2f3943ec097b8b3c5e30c52bed6436:e7001713383a0b94a66298471d59d34bc0c477e7bf83b2887a094bbdfd5f79cdaba7a5a22a46e0485d014fa59d71df64206040da81c8e35da57d534dc7f9745dc9206f6af9ef8d3cc8866455b219a047b',
      'astrotectu1916:CYXAHkDIedN:peggyhafnerb8231@outlook.com:daUgHTEr12:NCF66K2YC773VGEL:a0948b7788ebb0d233adf662aea42effb3bea31b:b82e7ef1efacb216ce732390e7842f8b8d1e3091ee572dfc4bec5153b09c0c1e7cd368e5d9cafd2ee6c8cf977e289fdaa7bb72de3fc13521335a24c8ca263678e339364e34dc4fe11f342a3f990bb249',
      'astrotectu24312:GX9rTncni4GED:sahorirozka9938@outlook.com:lishly9Xun:2MD3RHQLYSGUKZK2:156a71d5fdfaad30783e066284bfbbc3291bee2f:579163abfefbfd2cc402c1f6d737aff9372ffbf3a732bcc3fbb447f3f5bc1275ca68579cfef5de0170499710d9d93ae4fa07838ef26a2ab8ab14d9279c4a33d9e50257fe36b698975d5439889ccb13e6',
      'astrotectu25974:dzsR9XUgvq:mari-annelol7073@outlook.com:pERIod6I01:2R7SLCKNHLQ32LNG:0195793b377db33edea4e56ec33bfbec600cd0ad:999a06178aa7b43d4294771cdee9627d2127bd74d1c17c3ee659e68d24322bdafb40771e73016a2afe2531032733b95762cdce20dd92212b8637f47c302440326825f6af18770c923c4565d184f135cb',
      'astrotectu31163:AkcI9WeJmu:viomissyklei0810@outlook.com:lDivisioN5:HCBDOBIGUXSP5AKL:290b95f02b1bc46f520bcb596d3a01d68f5b0ea4:7c0ec0325b3f43768d065c671058cf9add181faa8d6707003f1f5b16c1f2c3e51832deb8cc9b9b5786623c01f9700dc269115b75ffe6df818f6ab3f59a6631e2a1d5bc65ad5026b456c2ed2abe2649de',
      'astrotectu33091:OAOr400gjDksbG:juliettetama3891@outlook.com:aDeousSade:YVUMNKHIBQVT53CN:6bbb7db6ec06399326274099ed92de9847eb0357:b87d21c7248e44ab3225aba3f151f9fd94bd6b1532543cc9c3cf48f434cbf5a3ad92b65b5df7612244930fed5cc3521f5d8d40c09d3fa2bea8f38321653b45d3f917ee5e0098c970be715c92f966ba5c',
      'astrotectu43299:YLVzu3SOqazp:anetteholmni0176@outlook.com:copical741:IL6SQUCD6VV7UGL7:6a2c906bbac88d0183c6022a49acddde64ccb8bc:305d82bb7b5f66082d59cc7fdef59d7c541b89a6068bbefd13270bc2684b3aaba11260d96470712814447fbaf57f103dec7fd0a6870a7567d856370493656fe72e0f6532de9b83a48c85bae39a109f5f',
      'astrotectu46734:c4ZyEGWB4GVO6:anapilarevit0650@outlook.com:ermentativ:MSL73YB66Z67BVBX:c5d9b9a24179647e7d4d082437b7dbdee4924607:17d68196a7af7b61f63f53212f68758ba5c2394a2c62f92721f9f55615a48d70e8bf93ea1047f277d0f4cc1b9a8017c3a61dd94cbd06ab9e25a26eab162bdc085200fce816be620a22b0124077e82c8c',
      'astrotectu59639:IyvUomwLIcEsqJ:charlottakub4267@outlook.com:bUrnto90:KKH7TW67DKM4I2BL:2d839d8c3a1c4fd1319778e32967e8bf38afac64:ad558a23a0b0056938f78c1d2babda02cb6b2d13e21cfabdb0b910866d735faa1a79a0cfadcf2be73f86b95ea08f424e0a1939b05f2fec461d789bfeb8c6d55e17aa3a8bf9cabf1409de2e79ebf58c3b',
      'astrotectu62022:9yXtpGUMQBcSPY:mysutherland3286@outlook.com:m5procE160:7M5CVXRH7IHX2O7C:f2d872fcb53e233648c9f93ad30cce5789842933:7f96f9190fa7f92c067e62b14acc00dbe5ba49e8c47b8af00e5cfefa513e022f6e0e456c9b5d9cff6333894171a047cd50253201146190ade34623cb19360bf3780bdcc40883e956bb15cdb8356eec69',
      'astrotectu67048:AXDN5WqaclxJ:sumiepasqual0800@outlook.com:XhGinforMa:H3KOYGAYQJO7OVAA:7cf498c614bdf8bea8610f7d259440ae846974ca:de17c5a31d575e48c546c3e12d2884dee0b741219538b21b8c95033a8d7421ce216e8549aac5a95860448f6a22befa5986abe119711ffcf9895995adf4ed963b2c118143199efb8d5748d03d28a20eba',
      'astrotectu89141:N8yE53239eq:maja8411laliadt@outlook.com:reStAtIon4:RLOHE5IPI5CBI2DS:44f4a67093378f3c96c30e64993ce5e1fb218c9a:15a8f5d7e5c364c44b8cf999e2f35b02516f5bea15a25728057187bec8feb4dd2c90b05ae5fd1c85669b8fd39cdb8fa3c37c2a03c7017a42633c08f9b9ee4bdfeca58054074cab36559f8895a27baa20',
      'astroterra22575:W4DkYpTk9tN4PN:inorikugaken6565@outlook.com:eu29Pearl9:MQ5R6KBWT24E536J:80e433b18175b53f5da3a53dbc95c34fdb5092d1:63c4a8f7a2ec8e81b29e97aeba1f9b7028f99719a6130ec9b2c4da12bc0a967a921916609012716350dc6951cea9a3e982e4ea5b7b09e109d093f9c24651bf0e8733b5d25241b79f019b82b1d0e0eb67',
      'astroterra26276:WGZ7EzgaNL8:mariarosanes1607@outlook.com:zfGallycr2:KI4QBYATYMLPGIXI:b886af8b573b9aa6282f4440952593453ca67c28:8aadf32588c621984a45eef990d245c3196bc54ad49836a88adc8e44438463e5bea7adaf3acb6148aa0b5fc0b728dfcd09d660bdf662be488f459f5158c7f12682aac60c1d870ee22517f9a183533dce',
      'astroterra36843:BHX0EqfIy3CWj:elifluzdary6704@outlook.com:riButyriN0:2ZJ4QBE5RAGA4UVT:f91bd87effe8fbb3bc2fbe1889ea6a5dc4610cf9:3c51acd5c44ca322297cb6b2decb42c1e78cc5340975efd60c801e629c1382095577aa6102b9c7354172859b6df44aaa703320a40285ad59afa105aebddaa6b6356b9675865d8f41f0f7e40705536ece',
      'astroterra39351:d36PHFQzjwd8A:nobukoosakib2161@outlook.com:SICk89Jn:DETJI3QXJ4O2IPZ6:34fcb0efbb9c71cd6a86da25281d8a64744d846d:0d1fbec5edcd5fbde1c65e4de5a1619acf16e376802f4212d1532caf284f98765e25bb8bfab3e8bb82f1f47ce2883711ed95144bc3b46453024c453145261c344766dde8ecafa1d5d88ce7d04d28f086',
      'astroterra40230:5kdLplYtF9S:mel0030fibourbon@outlook.com:NtC63gramA:25WBMUDLAPSTGVKI:40fbd53cfd2910137e05903c0737ce3dbbc8c74d:58b3bfc3a875dfcbefbcedb8202099aa2b490536d7b179b8538bffb58d22aaf6842a470600c2461dd78b6a970b88a209239edff78ecd96fa1f1ca1f29159ef1e4712313b039b8c865b41e3a6ff621525',
      'astroterra47927:MBI9GYFP89:meggieferayi3568@outlook.com:aisypo05:AQAR2PKHBGTC3PYW:5caa3c90ad638c3abca37fa79e14824d19bd5ea1:06d4a77d7164e805096e8fba36d414fb8dc4e66968d2e83457b49258e34688ca0075cc5e26745410f549d651f27783412c093d61abb71445bcecd08eeec5b0e426cec8fb20c293a7a22d24b1350d4ffb',
      'astroterra55820:unkmfYPlkJjdC9:tamarabirdma1567@outlook.com:yIrst81b:OHUM7TEBAYQ5NIHR:e0f18cf3e6b5de6ab19f5b389c35c32156fc3f7c:6dc1860d65807a593cdcf2c2bf7195eab3d59b514ae7efe39fec88f57974e8152418a6aa987140949890ea55d172ebcb3453ba684ac957fa265b1508bd056cef0225237203e30a6f5b82877035f69059',
      'astroterra62565:9E8GtL4LAUC:hinanodoerte7402@outlook.com:r8Fnintena:YGLMEYLHWOPZX6W6:cb800186b12e9daf0c24d95b3df401bbe965b5e5:811710b3736a421a887db7d9ef0edbd07ddabe8e04f026cca3fb593541e13c2d94fbd482d6549525b46a8be693bb9b114eb41aac63d2e1a115d32334a9e65e5790889e29ede5c88e09d859f40c9872f1',
      'astroterra63421:ePRJGfY43vUY:hommahiyamam6482@outlook.com:doUbt25m15:DHVW2IILAOKVBMN7:5b6db07179bb03fff64a8ae71a6a8b4c369f009d:9c5b0a0b932aa98c4a1d1efc63641f3c3b2912de684e82b48eaa3832172fa5d611d4e50a5f33eaaaf0358562bc9cd2012bd8e7896dfe8e4bd84a2c0d0b9f483eb23d496b17b967f1d685903faaddae31',
      'astroterra65923:9RwJHA0MzpW:arantzazuyuz7947@outlook.com:leDrummErc:BKHLMXDN5JFPOXHF:b18f78512293464f2502a62a0d769b0143edbb82:ba244ec3469fbaf1ed67176ac13bb5fbee86248780ee987d24c443e7ef83d12fa1e477bf2be1b3dfeffb9ac85caca22ede5921c3797ab68f9c8a822e9d0a99f8cf611f6dc43452fb03d390e8b338fd4c',
      'astroterra80440:I5WEIFToGx53:goyaannette8221@outlook.com:N96UISrbPg:SH4VPYNBD356WL3X:ea6d4ad20835eac3803b04978a4373c68256a378:fb2cfcaf87fbe37979cae7716c30034d4110c5e8f0a92994947bf1f70910b7d2081ad751c6ec1935678fa9aa522e9354fe99856c7e8d743766da3085f4bad6dad2df70f6d888871b8973b4999b0cfe28',
      'astroterra99869:y6v8OslC0K:katsuyoshirl3786@outlook.com:GladxSWZ95:WEQU6IYGS4PPCBQC:7995fd53659c7505c6b2b27eda4d1087cabeb63c:ec1a8b4fd18a1ce0b2d850d96fba552bbb272f5dcb4e65834a21b5917ed63ae0fc99ce54f8018a97a38bc964e8abf69cfd5a98c6f20f0bb9f2e0df9ce29879649263153aaecde0ba82f0a0e8472000e2',
      'astroverge28090:QVnPRAAMqE:zuzanawerner3493@outlook.com:aEM1I9gS:Y7Z7UHDMNFEI54BP:104b1de59a7220823e3c4d2017d43f0278857995:800bafa2054f70a57670c0fb08e708a3afc4c18f84774291ae11598dd7118b1eb21000849bd5e589cb9984fa75c5d90c7eca2b37fe6d304573a2598a867f6df898e5228fcb7462127ee13b95d0f17ebb',
      'astroverge30846:TZJ0iSMdIJowr:annemettekit4820@outlook.com:cEZul160:RZFGJU3T7OT73AU3:b0ee91573b8b78847a7df206e8fd43cbe246f093:cb767a0111c33d00d295d33e60cd8aa2a2f814fa54eda87ea64ffa7a193ba350bab65dfc3177ce6ec5d58a11d48e6b6563dbf55f8fe5a629bfba8cc509d473c9c1b2220d326eb61f3cae7f624e210c64',
      'astroverge38273:YQ9fNxDDCgVsCL:dalimilanano5981@outlook.com:jaNuaryunf:D3GEUCAB4XVDHWOO:9946f080cb3fa4a781dd171e3a0d0fc370e8ee0a:1e8214f734adbc1b634a96410fafd48f80bd2b74ebf3cf69e8ea41b96d52f8da54c6ea35f04557027ddf5c0c3b5a0fa8ca94f3f3ae239052ea7666805b965ea6a114a7302931bdfd37c0177ea7d4f4f3',
      'astroverge51198:ax15knCW4jG1:yuriasusanna9989@outlook.com:ToryK46fn5:AQLNHZTWHAVFYHNJ:36ae241c61b68dd9d1b7f91dc8a090c5fc017993:6b0810792fe4aa478ee22ba25e3f28eb23a2b11d043705aaa98fa5cc0796289a82977fb3e3fccf292ecc60be1d6a0edf7f4778660af6b4d6c7cac25af126ffab579b3e74e13d1a19587cdcbf15816b0',
      'astroverge57508:BFswtOxmGfn:kahinalucink1412@outlook.com:icLopuscUl:EX2ANXI7MT6VHS4F:e1e0c5926b9171d92a3b7bfe3028a51ed5c62478:97d1e5a5b2d72149dc3cf4f82ad52a455be43491c5f05711f28171b7092a2467c0795ea82d138b3e70d6eb3f51525ea48cbc53a396e44c021be80f755151556097eebbe9541779a304b2d7430eb05662',
      'astroverge67830:k0fc39n1DnS:tynaconxarec7728@outlook.com:O1CoNstruC:WFV7WHLHNQKLV6UR:2b3b06e0aa0cadb326171fbf708388bebc81a018:dc4765d23c3c5c9361f725cf6e8d6276ce7dc5b87f5ead2beb0cb90f5c66a2284ea26937c000acdf7f6add9ac66cebcf396136f051dc6d427999cc1c6060eeca749de115ac9b066021ae298241955336',
      'astroverge73257:5Mh4LFIGHCJ03J:carmelinaman2313@outlook.com:rtibilityT:KCIDOSHYI45VZXYX:d827233c76344a7c128cbcbdcea316c38bad01ff:1da1d2a88b6a14f6e058ea69f9c9f56e84a04932609fad7c552c19003baa6cefd8484fcb194c3acacd1a084a29f8e82d7f3e4fd18d5544023d4f5a29d69390989c02cd0088b00e215f194468b5d984ff',
      'astroverge78227:YlO9m9WAFGZQ:imaialexandr0622@outlook.com:A8VieW90:AWQ4DX7JGFKDROHG:7408b76d76cb044c5b1facf3c0b9d2cf6e8457d1:a01af277ea2fc828a3dcaeb087be4543afa7e266236e5f7ee00a28ad8167caca0430385264cf45726254e0267c2a91e4cfd235c8e8220e03217749f5c8775426bf0d96adacc27ac9569bc394b4736c84',
      'astroverge89671:vAdAXrHAlMhq:yelyzavetafa7265@outlook.com:uscu8asle1:SXRO3Q6OQUTPWNU3:e18d86160f1f638d11199e5daf606273baec134f:48a63837f13cbe00e81c9e0049d5194d544b3f129f0cbfb8d58ecf1918d73322b2fd7485cc28c137ddb8cdd8c4a16e0359242344b3ee7846c90d59c4c7f36f9c2b8fecd36198fbb44fa479e5b7fc9bfa',
      'astroverge95142:sCPNluquGFc:naddayana9630@outlook.com:Hikpropaga:4VCLAGJBDGR7T2MW:726b1ee5b9fd200956ebf2db01d308d0e65b44ae:e8abb16b3b7fab8f513b8e4c8f7f47b3bf68271165a2835bdd675e1d29ea7ca901b5276e7b5cd470b4dbdff660d2b9ac30eb2bbef658be1db6fa8138d854250c48eb8e4b5c72590d61b14299fe88cf26',
    ];
  }

  console.log(`📋 ${dataLines.length}件のデータを処理します\n`);

  // 統計情報
  let total = 0;
  let success = 0;
  let skipped = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  // 各行を処理
  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const data = parseAccountLine(line);

    if (!data) {
      continue;
    }

    total++;
    console.log(`[${i + 1}/${dataLines.length}] 処理中: ${data.xId}...`);
    
    const result = await insertXAccount(data, containers);

    if (result.success) {
      success++;
      console.log(`  ${result.message}\n`);
    } else {
      if (result.skipped) {
        skipped++;
        console.log(`  ⊘ ${result.message}\n`);
      } else {
        errors++;
        errorMessages.push(result.message);
        console.error(`  ${result.message}\n`);
      }
    }
  }

  // 結果サマリ
  console.log('='.repeat(60));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(60));
  console.log(`総データ数: ${dataLines.length}`);
  console.log(`処理対象: ${total}件`);
  console.log(`✓ 追加成功: ${success}件`);
  console.log(`⊘ スキップ（既存/コンテナなし/複数）: ${skipped + errors}件`);
  if (errors > 0) {
    console.log(`  - コンテナなし/複数: ${errors}件`);
  }
  if (skipped > 0) {
    console.log(`  - 既存データ: ${skipped}件`);
  }
  console.log('='.repeat(60));

  if (errorMessages.length > 0) {
    console.log('\n❌ エラー詳細:');
    errorMessages.forEach((msg, idx) => {
      console.log(`  ${idx + 1}. ${msg}`);
    });
  }

  if (errors > 0) {
    process.exit(1);
  }
}

main();

