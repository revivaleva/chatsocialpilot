/**
 * 今回登録した100件のアカウントに対するログインタスクの実行結果を確認するスクリプト
 * 
 * 処理内容:
 * 1. 今回登録した100件のアカウントIDを取得
 * 2. プリセット17（X Authログイン）のタスクを取得
 * 3. 各タスクの実行結果（task_runs）を確認
 * 4. 成功/失敗の内訳を表示
 * 
 * 使用方法:
 *   npx tsx scripts/check-all-login-tasks-status.ts
 */

import { initDb, query } from '../src/drivers/db';

interface Task {
  id: number;
  runId: string;
  container_id: string | null;
  status: string;
  overrides_json: string;
  created_at: number;
}

interface TaskRun {
  runId: string;
  started_at: number | null;
  ended_at: number | null;
  status: string | null;
  result_json: string | null;
}

/**
 * 今回登録した100件のアカウントのリスト
 */
function getTargetAccountIds(): Set<string> {
  const dataLines = [
    'infoborne16185:S26W6qOKCd76:satoelu4993@outlook.com:eiNdicati6:3MPMIP4TFGF7JTNA:6e43a20b638dc3f0622491934358aee141901146:9dd19143cac94dd5528db262aa937cdb2a5a85c9c25bbe480f3f2b97571e8bb59a1d1d981622b6b52beaaf63aee4994241852f27f4d505a2aab54677044348d57473e004b0d1147e33278573c69e951f',
    'infoborne113558:Cu2xYaCIqx74ep:nagakoroula9239@outlook.com:Yt22GuJLa:GVFJJV6LBX2TEOHW:8346546d32a3f041b8a228a5f865ab009324ad30:57e686890cc362feff3d8534eee337ad62da3f8f67e8f450d779c956dc49e7ef2d33340cc5129564cc2047922c4ec88b5ef79fbb3d6ed3a8ad3726bfd0f5fb486d0b1b55f3a0d674c1bd5d4215534de9',
    'infoborne142981:VWLPaDXkMq:mayukomollym0341@outlook.com:RthB5n12:6C6ZHI57TANCXLZ4:5ebc118103085a7b906c517a23fc54950640be64:4b5574aef9e33a1d2e0a1529b205611e3db635f971944a3d3a4416e3e49d31cd20d292f655537d5ecf183ee5615e6779a587ca06dcfa9a57e8c03070e9085d692b40975fa262865eb4b667f95b2dbf76',
    'infonimbus60569:mMRghbfLeG:hatunhinzely0101@outlook.com:bIgger15:CECCUA6JLH5RMKSN:bb63e179d87706a3a90c59eedc1473b0994c83f4:6a6fbb8f7003147ead83a4e6cb36287fe664effe09d066959d10f8d5721c625075ea90ec2c5de1a5d17e71866f37ae316211da1266fa810100ae0a1f003686fd8fa92c8924b748852190bf39e6739b0e',
    'infranova349288:Dmk34Pm5ie:maritzaalina1251@outlook.com:ewDfoury19:4KWFCS4B3V3LGDLS:8c29068646e4be0f24c7400a00c55b607d762e32:67e3011540ad2f67eb8d9c59f60bfd36a3f2aeadda106f6858f4adc182a9c229246902627b2b4564399b04b59e5482895e1c3ae3904b1c27683d17d0df939d85fee02d6b7e3eb388e4014b029c4cceab',
    'infratechx78684:4kzoXKAdBtcDeI:michalkazaja1452@outlook.com:tallineZ22:4DMVMQXZRJL4LUKK:dfaa828a1db4134f2ffd1e9be6eb399b4371e991:5cf84b58b91ed30edaa6a6da7f2cdaad19ac6efff6d6155884ea813c455fc1f209a63ed6b85423518ffbb303f73f2c6c083f59ff767a6411b44c1976d10f50d389268a3e40f052c58cb3d712f62c5c73',
    'ioncoder78093:QoD5AyJCrPHt:faypaolettay0864@outlook.com:g4ZF66qN:IALUTLWOZ24QXKJ6:0295bb8bfb26349672b99c2c35e6bab1d2ea10f1:5dca8a5a4f745861c99cec91bfe540a3fec3c6b0ed705ef08fb6a9b62b0ba6d09fc53dc053ac5df31e6d166d539627c4147904e07a3e24dfc3c44b5d08e507fc28799da12f0c4d9acdd4f5262023a944',
    'ioncoder82762:mYujTWpYx9oLJJ:rebecagirong2762@outlook.com:BFKoEl25:KBBHCQI4CXTWK7AM:b69128bdfcafb41a5c6a2aa4111e759c77ec19a6:9c6b042365470595d05e162a9c73f90f91f414d72839415b74bbafbf47d142dbc80fae41d4b37de8ff41b9b0d877782ee8aa64ffeb4eb486a7393e6e94ae1b32f6e4bc22e43e1228b67a24a2d0373a4a',
    'ioncoder85679:ECSAPQitzFN:menekseyildi5754@outlook.com:SFQ21aVE:BY5GKM7DBMXDBUZX:bb5bf2e41a18fa533c14641f95b884f03cad25d9:3d2ba32f5751f48c75c51bcde0376d8e976b27fd2f04403d6c337699d15dd2e3bb395f10c8e1cb5482f5a26e238cf6d9dc35e2895628a8166a0865e0e26ee594cde7ec922fe2ece1fc8fc3a49e7178e4',
    'ioncoder92030:KF18zZdZMwZfO:zoraidaaissa4842@outlook.com:sionisT700:IUGBYT4SQBJNC4SC:f5ef9223f204137778442ab1ee153faf84ec3cc1:7e12fe47e8812efa48b8aad10cf4735f2d40b201e1615bb38f821c673eabcb463570a72729fab8def91b637b6e9b43d72811e79da29348abd5874c7e2b2e85dec5751eed53c3613802746ea826d575c4',
    'ioncore80375876:tWw65tXJUn:hisayomanola6986@outlook.com:briGHT23Q:GWQQD4O7MI5IJT5K:0b7c9e6a991c4ca9a5b190b816ba4d3a5842f13c:87fd357611fe427bb491cd6002dd8dde97c45e0003902ec8e4e1f30d485870845458cb69f9ec40c221b612460fb3826aedb0a593a70e0e1631e8b8aec4e424c295a6a66858dc9b9559d9eb52d3eeafc8',
    'ioncraft135614:tR7A7m0VBsQg42:milie1956klaudie@outlook.com:GindeeD350:5W34HSUTYDBTMAA5:d1d0a58415fa4c24cd6215ec3786fb1b17b9d744:d281f88770f785c33b5cc700987a9c56cd13233455751925f511f355037b667bcef842ff49291fe130535446fd64c6f0ad7dbd30d0fa3a25f06e4e447e4fbc9e56f33143f0d9b346b436d3528cfa8851',
    'ioncraft168748:s7Ay0DhmNLcN8C:kylamathewma9386@outlook.com:O75tOnCL:ULHPLXJDOUCV3XFU:71c5457317fd4be35f289d8dcc5e99715cd02617:a792655f8074e32611ea91d03ed5fa81f8a85f1d7b78116fe96393d389f1c1e7ed13b06e4c97104ab5095d16e676fe3d84e39c58f044fdc8d44ead808931a10b9935e32598547b3bd056fbe3ac6b2c51',
    'ionforge167180:UmlthRFcIfAzEV:beenishtakar5746@outlook.com:STIllT759W:4Y7ASX3YBOED7PVI:d9de3a4e25813aed7f3ef5578f30fb6d25c797ab:98e9a371b2815308066f510c8f3e9fb86686ddf09822013273e02585ce92180a7540ec2532488edb395a9e65c34714f451d27a97f5301c9b04e8747b4401c1bd4224c9744b09ef69eda9df9bfe9d83e9',
    'ionframe118659:KCOGcxJ3ceXExn:houdavincenz7144@outlook.com:swEEt322PI:YKMVQGNMEL2LINXV:6080e080cc18ddc9cf65b701ba73c674856fe602:abfe91666e78fde3814c8047efa5bf44b4c66a15dff5633714d885589fd99cdb50899d195066c643dfe005bbb6bc3a770118bac66552de05af020cc270a9596807963c2f6a2ba545616813d58c383c95',
    'ionframe120010:0A246X4hKU:gabrielleann7462@outlook.com:7WEmoVie26:XWVWZ3NSJSPRQXBU:a962eb721b1e7c3df3082bf9a3c545025f5bcc69:59e2772763db67452c5a3baf1e5de37022cb76c2827aab44128f5106a5051b5a8158af369724d8cfb8e60cf5b1c6b20ea34855c46dcf6b3bef243bf99bdf34b3d3a1e15f97541315fb1d2845c67a7bc9',
    'ionframe125433:QiOEftipGMo2:kirarayvetam8405@outlook.com:ophistIcat:2UAJMAFYIGCLOUY7:8772b642b4af1102c46b2fae82d9557cf3c06b75:ea7d389c9f3f7dca05b6ad6c964eb8abeab3b59fa01a9bfb36037ca59a9f482d956e2ae01d9393a736bf6ad0d728479a6986001c4673b85d6cbd27968b14889674bfed466c33399099d546eca931daa1',
    'ionframe172154:QnUTST8UMdGW:oishiharutat7135@outlook.com:ruB480HO7o:QIKR7SLA6YQVDTUV:ee14e0694df30996de79037e4c150f1aec50f1a1:a2b45cd3b396f80c814f6d77de531ef5b3dd5cd91a46f1b9c872182fe702b5c485e67868f06a5cb726f8ee657adf3dcf2762facbd3e986e2d77066972e4685a0fd3fa45c11b066a8fbda355fc5877c8a',
    'iongarden143124:nDKOIh5Vvwo5et:nikolinkaada9577@outlook.com:Ared91990:IZS7TIJLNWS7PXFQ:7946473bb63c4ed6a4ac225a52b326655a0f61e6:f36719fd1abda0d83909b5d087719c03336e01315d8dc7abfed2181e112ebcd9950b5cb0839a394e863709e9aa1a380997b844c0f89e5ec3927d81d95c86fe3cf36137e1c66d4fd0b5d4b5cfaa7170a9',
    'iongarden167963:angVsG9ZvZI:melodykochay0441@outlook.com:OusgastrOh:XIWOEFRNH7VR2GDA:9cbf5870387e350645264ed6677553dc7ed3952a:a3b4ec4d0c605ad24804e03761ac66afd55f0e8ca8e2761fb0c92b59c9624f4a26b12b5da64432c7b7b3babf5d396050f16e579e077e744f69d6869c0cdb880c28fd0df5be6350804b1fe5685b0fe60c',
    'iongrove99277:CbAi36f7Wo56c:anettkanoriy0958@outlook.com:pHyte62Z:PB4CA6AEWRXNOCH3:38b947f398688ddcd0aa88febe1e0f725619838a:ff6b1ba7e5691cc9f5c939659c5fc437143f89522dfffb95c331c834244466edf36052d481f1ac4b3f82afb5f4b284915644a53fa4c1b999816e488b883d7c7e07b24e73186f5e16dc45ff84b4f9581f',
    'ionharvest61954:woy3HaDaL4qW:sumeyraberna2175@outlook.com:CEntirely9:R6JCGQUNJIWCUYY2:cfccd488e26859be26628c18320be4b1ecb04c54:5c7f58ad73562eb1358b3e7a830dd8e5543cbf31cf1746675d8a3916f106eeb0555851f137bd500cbc98c9e51ed0abc37e2ddbf68a1d222fdc86533740ff7ba0620f2b3ab1e663a7e521a69db9c2819e',
    'ionicsenti63144:QnOhPtDhzOm6dQ:shiorirena8999@outlook.com:476QWgzDy:6MOSQUW6QACQE3OE:80cc4c5b3b6acef24117627ec19ac5861bc404d3:3de2c05516e1a64f2a14bae9a9881fe45b2ab03d3e930766a28006405e511d6a7db3bf02c2d72d67ee4f49e7dec3257baadc0352cbd2f0b5c435eb0bd32dd54bde82180003db5cafe4e4a00eb3b7532a',
    'ionicsenti68742:B1sp3pqA5l:janellehoshi9747@outlook.com:Ty6LatV10:OANQPLHOYABHNW6I:32381b80e3dd89d88c7c51d4cad600940651b301:dd9da0944acba606e37d817f5017549431d07269b99a25c7cb7a04fc89d0b5eb169187a0dd66458008878709f345bc6f472e8a4eaec2c80f414125553c859035213998888c023f685a56cf9de38696fb',
    'ionmatrix124260:o9gSRDBzRUxVS:hansinelynse6596@outlook.com:ratIonIs08:YNEP2LA64NJ5MNJL:8188dd8cbabd4ba04b5aa8f9349025403fd1bb20:28ddf46388fcb68346c16754e57dfb3d5cd9238f765f8d1460e0af557f1a09e55b0cb4b043b8e26f4c732adf0eb4899ee9a84e11be19cffee15eec7d61f3e85c0ffb72713dc8fd05b1094296b2de2775',
    'ionpillar16476:IanHKcsYPs:margretmeret6549@outlook.com:fUllY3OT51:DNEPWIZ2GOKYFANJ:176c785b95362ee7f879c1168e43ac744161a627:16eb5f7abafa797ebce0ac57ebdd13c8c7ddf4a659ad9520949090db8ab25a1266726ca27e3609966c986e63d8a1e0f63fe21cfd4977642c2e40285dc3a89461904fe80e2f4c156f6bd4f3bb22b1176e',
    'ionseed138902:ZeVCRuKFEKc:saskiesuadad7336@outlook.com:taryBw469:YMXUDP6CV2HRILAW:69972919313df1a0800bb0aea3ad24c47415f6bd:6c5710fcd5512ebff72cabdd6dbc26eb9fca000320029f1297eb0d03ab79def8402e0e09ac932ee04f387f73a872052a3bde60ed825472a0b5eb8dd854d150caf55b581cd323118bbdb041ed197dc2d0',
    'ionstream268837:pqnzJvzjcY:hendrinconso9330@outlook.com:SoFt318Zg:LSGSTGCQFFTE3MY7:1bf88f9ca6c11375ea216756d2f53c440cdec7fb:1ec51fe71fc4d1919ffb54fe9df2f74bff27a67afa4c90a43dfc1c8177b874b0f6cf2d28eb3b78ab771a2d93d4e6714921053b1f760eb583494e3b4e027a003db3ce271de88e4ea3e4f7a831bc4a8b57',
    'iontracer41301:3t2sDcOOz7K:evaneubauerk5118@outlook.com:T5P0mIsexA:LLWY5RKZRLCBM2H6:999d827c8b857669daaa0c7d49c91674f57de784:66cec140f84a47073c0db4c6bc12a7f3b03bb634af8b06946828faf98d269ba27940e57263e89584b351c88a594bc4478e8b15e80f17f7def83d5d51fc0088b260c842cf3c6cb33ab6d7753c56ab795c',
    'iontracer89911:iDVVgQWIq6G:leamariesha7791@outlook.com:utAteulabe:L467O4IKLJNBCVYB:84a9f26e5f2b2c7a821cdcdd0e16c452b8af6c51:ef78bec7a26bb94e0e8b7a4c98df751b0ce56f692b6196dcd89f9753ec5aef2ecb609fa4d502222a52dd71da3c3e43d6726a4b3736101e030951fbd3b1a0b4f8f2ee8b30281316e35f50fe887edc5f6a',
    'iontrailbl90905:MFwevVt1fNO:orsolamiho2358@outlook.com:GPRoble160:74LSY4YQT36GRH4A:06f65a6b11413504a7b19e9544f776b76b4b4386:2e4c083fc9c3f37068a99a52b59c5bf0b1d9223de6a743b54d7f690ce2026bd9d797f1a6bdddc160c54cf8749f3ec727e094502c2381e112826972fd8f356c7effc7d06030be7258e1af15763a6e6b38',
    'kriptodalg68661:bYINhFX8ecZA:masumitabata2209@outlook.com:ly16Pm3qsV:3VNHGNDOQTSHYFMU:79acc98f74ec41a6d8f04843d7acf94d71888d44:bd78a0c19f858f86609d599c0361bd4e9a80b242fa0494b49c8ccc8931bd425bbd894db2dfc7c4bf6b9f491d8be56ff8bded5f9d8dbc6ea4c51932a85f7c83eec8a2a4beb12bc202471ff1bd25c0bafb',
    'kuantumorm23123:ZjWb9ke2uG7fC:jaquelineman6470@outlook.com:Y54ZT8D7i:ZRQI7GDVOEBGGNZL:fc025cc2ee2a8999ce68695e955031dd7a3ad2cb:8f0721bdc02ddc73d15af840210c2e52f9ae9f486eb023b641faa9b967e3646848df1ecfb09903b44d3b1d53f1f8daacbc0719828fadb588f60e3e8e85b151702bafaa389d1fc8037902fbf393e034f9',
    'logisphere8622:22LwCtHAwCe0Mv:evemorganbir0400@outlook.com:FproTistic:V7ICZRSNLU7S6BLK:fd590843818ed3cc1d96599b023dc18bfe1e0961:556904e9a5e6079ee6569654f8beb2ffcfcd8157c32f4944c81e853c481a8b02a8e2c05a23135cbbb08616222ce28e37bb644960c6789773e55bdad5066104005ba4ffe5df9302b2c3cd470640ef7a60',
    'luminacre197937:pQz0lM0Kgkq2I:tsushimamias3703@outlook.com:iAirRi1984:OMYMJ46G4T3TKB6P:18c04e49d45b4ed497dc0fa5f7e673a53713483c:de4d9969b138f910e0f919b888d1232ce096f6fcec448b848f722a4bca76fe07483ff7413a1dd0e03d3b1b23917eda86d8cbfb90470146ee2b2735d3c0e92275f085ec3439dc95a01a29bd50079485d2',
    'lunarbiome66670:t2cPq9nfgGIjMX:nerimanmihir5361@outlook.com:icL8416SPA:HOBQA2OYPW5HNH4H:0d56d4cbff394100eb3a326e99843410f12676cb:10a89cbc0a5663141d87831cb7c27380840e27b98db00ef125a815d0aa77d444f6ed38a4b317decf9b061514584ec4a459464c85620c961f4d76eb38d0171c410dc5210e7154983a386d99bc70f9460e',
    'lunarbiome79043:jru6RVce7dV7D:berrinscheel0525@outlook.com:HoRn3459p:LPX2U3ZG5Q72ZM24:8be54c2a3f65c098ae420fbfab48cacdd6d43e46:91bb29eb24e1e2b6a87aedc516fa0117c9c9fbd42a586adbfbcdfa422698844326e376cc4d84251e3296be9974248983d4dbc5b9a6a311661a293ddf823e3ad51ba2100e1c949ab258d1f214bf848ca7',
    'lunarbios18207:1VzF0WigaN3I:scarlet3469nimra@outlook.com:reckoningh:SJSBPZ2GLSYNV24Q:116a15af98920de0466f4ba192c6a8c7456cf58a:a04eb0d1eead2ba87a42c665e75b45a416375b55a611d4c4e9abdaa9179d619b450d123dcc6dbc5b8d0ec9db34572eaea75962a1144b942e1bdcd705faab70d0d8c890b070bf5abcaab4519242f966b6',
    'lunarbios97220:pgslUBYbBguGI2:nhungbarnett2169@outlook.com:BSlQv1303:ZAVNOT2CMZU2EEF7:20418f017590f34ef2c6d285eebb9268c8fcb5e8:052641693ea0860845de1f64e522d26b68770370107befe1d4c719156ae1dcc27509c803f84e151839e246d08fe03f3b0d730bdf517b7abe577c16d560524f1d241ab8b3cf84c019600ea406004e6b42',
    'lunarbios98069:t8sFGno7Wz0l:pepymorenofe7055@outlook.com:eQuipMEnt0:3Q3WIY6TH27P75AW:f7fb6229905d5912b8536260d70800c5a4f06326:23acf0d52f20de0e5bd3846a96230966f8254df4f26dabae7c0a3167db576f6560f50ed76898a036fe24004ae93fc3303ccca4e21c54b46cbe4db680160101eb46adeaab1864e1bf0f59313bd20410af',
    'lunarbotan27116:lM48WMviOi8e:yukimikawamo4372@outlook.com:4VjunEmV26:Y3G3W7NBVELWRPTG:e463ebd5444fc3d901c7e16d74b809f9b0b00269:23623fa3f74c38ef0161d6e684300c344588d0dbef825c75c2af1cd836bb06652d1d9adad0ceec42017786d242bcb758bdfe88c73df556407a8f5737472a84d6a78aba8d9b6ac91268480cf6298be818',
    'lunarcryog80108:XkXDoEOYVF:nikolmarilol4216@outlook.com:StrING2L94:5DBB355UGYOR5FV6:023f9a50ed2364c51896d7371cf68774fa72030f:b0230badee9c34998372401387e294fa5d16bea599bff9e494c57da4dd324aa226e969a7d64884c07151ddb40f0740b0c8afc252044a35cb41243f2015f64bff21c07364ba218dee58f27df980871c81',
    'lunarpilot34511:ZCtv2tlXbW:sayukagaia1291@outlook.com:ynAmism76I:BBNDWJLWCN3FGXGI:510e0c2e12a7603ebcccb4702479e678877d65af:a7ab0d70e56b63279888d801fb7712ede4a0f5c34f13f5040e7027c354f525f2de1dbfb812c4648d90b7ccb2c153a8c3d753b88bd8999e63a64b7f95d227e8d0bb7b4476318e63f066aa568b65a58ba5',
    'lunarworks45598:7Q71VZG1O4Kq8K:sachikogytte2613@outlook.com:1943e9zL:OSQV5YA3HRROPQQM:ecc6cb2be73452b55bdbb77c0daae7feb54b04cd:d8d3345272ed73eeac8211d005c4df0ef0adbcd26ffeb7181e3ec3934f84bb08ecfc1a50bfa22f80c811e2260ec72cc77d14ed421ceca7a086bdc3e9ab951020e2b3f53b65ebb40c745bdbeee0689a15',
    'lunarworks75904:aR61ZvJBkx:aguedaperez2790@outlook.com:AInonlovEr:3UARGJIUMCXM5GYK:7419d0aa37ddc5a3ce95ebc6a0d5b156e18e32a6:e4912abafe7d73637c470d6bd88f402aab9982f2dd692df13854ad8c0058f21a2addd59ebb46d3fe0edca58bbfd89952790ff3586b31da95481c25fe1cf838d4edcfc63f7adfbbc8574d9afb5878a41c',
    'lunarworks92330:fufggbpEq7soU:krystynakari4152@outlook.com:houNdI9RE:RM56BDVNV3QJWJ3E:dd201d8de9d6d3dab726c5be6bccc554925d85f2:9358a663918cd773c915a712697b1a0b4900a4b801dc177d2f4f8a544e638ebb3ae95b4ee20f777f230c411c6b7145cc44618de2b3093455fd7767a4a286413b819ef226a7167fe4258e05872fcbaa82',
    'machforge98358:L39mSjXbxx8T6:tahiracandid6742@outlook.com:styleHa171:NW55BPYCNNC6EQTM:f13c5ba0a10759ee80d07f8604537e9452ecefc2:a06efd21a5f94599a4da2b27eb8b99cc9ea3026c10d4a4503cf9af325216cf4239f5b74d29c888dd54f88ee7b2366c7a7358809c08825bdac072412b162b90df3a056231a9739c0fc55909af9fdb4aee',
    'machinova276376:qTXxQtMiCUo:birtemarieal6964@outlook.com:StOCk2002:5W7HDZUIKYEPUVF4:ad9e1acad7bdf6d6d0e1c69fdd536509224ada95:7a191d98595b279b2cdb75cb3026d6b1271d0a77743db031e8057aa9ef455ee5c175d9d8febee99994560f958e2079849512c1a2e9efffe46e7c68b8319faf0f1f8a21062790cb23406fd2fefccebc4d',
    'machinova279351:XdrKBikJklJ:makinoanette3278@outlook.com:opathOloGi:VAVNF34VSYVVCHEJ:91da61ddcbe602d0fcac81e0250b69c04c843924:3e033a989a6bef56a91330ad1b8a5a4928b9d0ac1026f542787d372d9826e1071015fc6a8b8c0530e00b9d6ba23ec5e802fab5cfcc73bc08c33990d95b3b0cd8d7783dc73c8cfefcd8006e96a5ff8e63',
    'mechabloom42279:ZnvqA1X3NoyV:azusanatsumi9528@outlook.com:MIstakeP85:KMZMCO7WPLKMQQF4:06938fd65cd0f180855f91aee3e8f91641b4faca:2278c9a5d2fb8d51af1793198154a3458302e34cf86631943b4c65975a6194f1476748942875be3e46eddf14e1e557ff4f2dae6da4c7875320367e68cde3f289c8483518fcbfd9e912648e3815bbcb9c',
    'mechabloom73028:4qykBIIKu9:liliananarim3794@outlook.com:netic26Zfi:6WC2FOQGHCUNYC4X:c5ad81ae6478f98e4319bc0c14ecb345c3c7cbb1:d8140148f8df687c4eea491ec35b9a660afe53ed0a5ed37aa9c7a3d539381044fd3c11132398560108bc8b2d3386ba40f83cfa9219c5bd18edbdba6b497f44cc5a0cbb7ceb5e53482ed6180bf1c7eea9',
    'mechabotan4448:rnQlcyjOQhl:takekonishin6918@outlook.com:88HvwFpLuU:NJIUQFA3OYH3AAK4:447384dd900c9df464735757e988f7d1bea64082:a1b13b83a6662e70c300ce4731a6fd9dc53e5a611ac5be5da3e1afb5f73b34f47ab1fd0c0c80ae199654d241dfd52fd983203afcc6783a5c2efefc9f351abc779ebc12fcf03812fdb6ae896e0bbc553b',
    'mechacoder96226:jqfKasEP1kk:barbuchamahs8331@outlook.com:copulaTe26:UW4GHJJSFSTI6YWB:1cc16f4d04fcca5467a2083774518af1f6291b5d:8c651ba8506ec116f199b99ad0586c2dd24df770516e689e67c79e27388af2c60dba4ca87e0de85a972099e7441a89a9a15b21dffaf5504bf0fe089612f019dea78d38d1df9f7c1da5d57c0f2409897f',
    'mechadrift7387:NLWXfPB1ZDhvV:maribelradmi4696@outlook.com:tHrIfT0309:U5IN7Z5APF25DNWO:f9ad4b0b95a6173d746e1e8302c9fb00b4e428ee:0480d02b81837db6f9b3299b67fa528fcd2071a170e4786b094bc5b80e2bea79b08566a9093810ef97e3957666a4d80eb36299793d64ee85e3fb6a7d1f5e6a24c0b841bf91709e5363851253455e2a99',
    'mechadrift26620:pWQj4VdgTtDkVz:jes3131silvinka@outlook.com:ZYKOolAH80:ZLTZ6R2JXX7J6EFU:f50bf56d534b4f72f8790de3bb8875649a6ea796:3da2aa2f2ad57249b4e1b09072a54d3fc1925a7aae0e912816ea2759147cd457394580097b35b53d3bb1b9007fda5337769780ae43e9f11df77da1685ebb4640c4dc566929818502b45677f801936c4f',
    'mechadrift42714:3BvixD0auCMM:yuzukovlasti3937@outlook.com:kchimopeel:3DRSRWCLBWMAT522:76981c75e4fe38731ebfb4b759bd01ea40674642:c2c8cfe6ef1ef656bb93af8bae42acedf1c611f3474838e47594f5e0484ce76daf517f2cb62c6fc3a8a47bb1c34a799a596959ef1427a09f9ea2acb65969d3754d0f9593f81a5e54d25e2a3fe09c1ef5',
    'mechaflora63011:nGAR0CLQdw6L9:kathleenshir3341@outlook.com:ANselM53iS:ONCKRN4WDM2BNDEK:4c637f207940200929f8dcfbcf7333115f3acf68:ab607d963d60c5dbf24b003b3674132ccec0f8954b4a26a017bb1f3d9ff5de600122a1d7acf06b652c2f60913fb9e720f0e787ffbdcc5aab0176f9204c2ed0489e1ace89c26857def63b1a8e44a07222',
    'mechatrell432:nxXN3KeI9wf5Ya:lyndalarisal8728@outlook.com:LilYhPv03:IUZIEAMV53D7NI5L:39cd9c955a86e6ea10fa745ddd71e73e897c21ae:3d8de456a92bddffddbe0c8c972d64da88a454c88cc44e0f7cb9027e2391ebe2e7780308f6569e988a2183d677f9f1e570e4652b56814dcda2a10945cd75da228a6093c5b6691ea88bd5d19a551f78d7',
    'mechatrell25614:k997lqPSMQ:kirstenlunda9236@outlook.com:lOUD31002:ZEKEDSPWNOQ6W67A:8dcac3309878b18d50e6d614e0bc2aebcb66a0cb:c88b0720107c6ff38cc0ef0153c5dbdc3265ac43ddd0fc2dd9cdfe60cfe78b3528fdb6fc096b8042a5456bf74caa725ef983819647bb26fb1a4ecc918ccd260b4472415036d6c0d6efcd1da6f9f72bb7',
    'mechawisp12311:kg0CpIyATj:priyamizutan1825@outlook.com:g535CHgJ:O2Y7PB5B6VFYGLB7:dec1aa7ca37421cd7cea4c6f13dd636d6d26c158:4fc79fdec6d6bcd6f8f0bc9b0d26dff412e6351421053eab0b54f24cca945fc64cde39936b7c6ac769d98a03c265d1ea4f23f166956b3e2eef138a151f948a83092265a90ff458b3079211c00775d80d',
    'mechawisp72236:Sg0IpSWOBvuCj:laetitiarobe6533@outlook.com:oZ1uncompa:O6CNISGSQPZOVQE5:ecd11f0f2005d7a43363a6f9e8686227411bf8ea:24d6f2cfa917db4ce842b015950d0cfda3d30bb7ae32960e048319c561a384130034dc8558470ee12c63f4cba43c45cab71812c81af6f81661690f797fa0ce899076fd2d55df03732415e7878c260858',
    'mechbyte125417:CngXMxAmADA1o:yarelivivien4311@outlook.com:bly118upar:XVEWPXGS6L7APOIV:56284a7e00b872279b5f879bc452c383d5a8841f:ea38657d6c3d11c9891e3a21488a17768752c17f0ce0e944cd37388c69185d7d6d941bbfdb2d23028f6456981d0bd5371099c31132a337a566f4d7dc6cb3f5ab483c248636118d55dc74b992e5666d54',
    'mechbyte169842:xKFqSLuFwI4m:ladunkatomoc0476@outlook.com:GU187IXDE:5WI2OCX72SGYPVU2:150b53877f31ff9ec3ca4957487f8e831bce01d4:22f8b6605c3f50d459417f4e8215d1f6a1d33041aa67f64b9d0f6966549f2682766036339b7a857cefa373a0489c32904ba1cb7f488b02a43e43609246f521d8687971ce33abf74f823ecbb6bb3203e6',
    'mechbyte170018:qGCVbWJIg6vfc:honokaslunce6731@outlook.com:HOUR79I6:F2TPB3UEIOVYHQ26:c122cf187a62c692576a6670444fb0d26373e822:c59e5240fea120b9ed9aa666ab9a70a571a97ae22b3258d87cdc98f65cc2331b4b04ea1657868ac7ffa200a9215a4caaae62be1836c609d1b24adb8e043b23e1248e214ca6f03909c796f34acfad209a',
    'mechbyte183528:u7XYC13AcqqqF:sandramaria9161@outlook.com:ngCOX26QA8:CQA3KJYQZSCMPTDN:57f8d804e34bcb9a7376b91cf7382026641c4ba3:6d7985653afcdebe74bdeac3322812d88849cf4021b9cbea9107c762a2d06fbd1a2f5a1bc4f7d25b026ac6d069876d69c69371280623dd504ee8f51efa0ac6f13061cdd1eeddd2448ca4919a0eae1008',
    'mechcomet167409:Qg7NdY15qJ:rikkemariech6208@outlook.com:BROtulid70:LRQFXA53FOO3NFOG:f7b583a6016a3d9c9ab46ea7eac42a038582d527:826409426ae4d63fbb5c52e7a649fe73d68871638abdff5c01bf2e2b43404a906bbd18e3ad098d83f640d25edf40846a11522e85eb4a16d4e9c5c895ac43a98e0f464d18dce9ac4d2f421b50275a5569',
    'mechcomet186653:wPlKpOoIm6jpvl:chikagemasam2878@outlook.com:ucaravAn56:MB4YHZQZ2RGQX4FK:52fa846cf92c322c4179612a42d2c997cbc2107e:395f3343a3278258d585c8997b9a79e16106f06dd984fe0ade6efa00b4edef2d9bb7f97fcfa26efdc8e807f7245b12237eb4b9d8a8f679f64df6ffa35b2bde59622f9bee12e2d2bf63a6373b752634e4',
    'mechflora114311:qqdXf9yp2JxsZ:joudadeea0250@outlook.com:undEr29n:NUTSZ6AGYZNTY5CF:f2eea225f955c072e51184b9ebf0e7a51cdf6b51:f1c56802e60f16adbdaa39579cefdc7802236ba72f1029ab6ce0b9ae976272ec4d5c45dd7963a9279cdb61a3c4f87568f96591c64c17a48c214f2238a0a45da92009463659648b47a144f40efbedd6f8',
    'mechflora132337:0y38XJ8YPHjYw2:chiara2300deike@outlook.com:RinaeL1989:DEINUELAUTT3I64E:a04ed69c4c5b4767d38fae11f6b6aa6b47cf3c30:6d10a60e05b9a7491bb61b95e1bdb80dbb5f42e8806b0999dc71e69bf0ff8c05730f34b2eec3b0f5d274cc1c67ff067d3de31e1d2c8fc2541992f848834f68311b18a548124c8d917fbd8fd2414549c4',
    'mechfossil65290:qbrbwhwfAg:jackimadelin6636@outlook.com:dmeAsu59:ERLTNLMJSXZRYWW4:3cb4485bbc6e500936f134df67565c0ab318f260:cb30f9bcc0693fb928b5e4fa6f28bde991a590e9611be3d0d35856d49d633e7b0a113f69e179be0bf75ea13bffd3cc84a16bf6bca5d78183d097b7393513e4eb8ff259018bfbc25a365bc718cfe08ac4',
    'mechfossil79041:3HsWQSZui93kYG:gretekreutzd8309@outlook.com:moOn44ZQ6:PX76E45FCGZ7375W:e86239028569d443f2d6d6ef68e4472ae3974a81:9a5b39d7043da4ba22424baa1478f649271cf97e0cc01627563fa9044fb240c4e26cbf122ceb5fdd7fa50b0264810926df7c8b248c8cc58e4f39323dea5fb9d7bc3b08f8acbdaf04d9946004c4566ae7',
    'mechgrove35751:lNEWkJoqfZ0XpL:hatsueimanis9186@outlook.com:prohibitio:3PPLA6WYUOEGFQ55:deca9a05680d117d1a5f2a2b78028f253fb16d90:f21cee6c327e333af970f559bdb730180ef4945dcc774a517774bff6290078b34e3aa548b8dc235404b48cd4a08cf61ff4c8837febe8106e29eda7936289f432b9dc685c9dadba62e36903bbaf71d8ca',
    'mechgrove54575:A9kBYNSarFFPRl:mariarosash9410@outlook.com:dSivAd9090:D65QNER6QENDUWJW:3ca02ed35ebfd947cc44b0addbed1957746d6d94:d8dc5fd1b3d86381a576831a8289e793f214fa94aa3828470090e2306600b21bba361f7bee85236905292f704da1a8f2c65283a8972a61032d586286a0aa5702b42e6287948ab822ac9f71f6caead814',
    'mechgrove69763:DRwU0S9h8F:hedvigarahil3843@outlook.com:otblossomh:BF3CMX7JKE6NR4UP:db979cb0b6ddb4ec7a6edf710ee46df29880f0df:0b1093ef1cfc948c14bf3c73a31ab08b5a70999a6e5e067314506abcca4e50ea8dfff856f2009a32718cc92a0cb1a0431a89e7f24cf0ff5ea57922ce365369aa6ff8e5010856431f421ca56bc20f4ac6',
    'mechgrove87299:cEUBroUf0Z5v4H:josephaleduc6538@outlook.com:tOlDA5104j:ZEKQ7T2KQHV55QYZ:fa239e005b28ff9353f29d9ef0fa8ab81baf0e38:ecab0aef0184d2ea4c0de816322eeb65b629264113d2a6faadf03798840d030eae405178ff26833a77b3af80f173366b28322db613427594b362ba136ec6beee8e60f18a48c87008e87968301812dbbf',
    'mechmeteor34417:uI5An0Ssn6ttN:gitamoegikoz3911@outlook.com:IDe438z39t:FTPCKC4REYCHO4LL:ad026f2afed4c0fa06fc0df6b6575df56a0ce3ea:5874162f68b3800b5a981b2eb17703a36a08dc503c83710e0c49a7ed338b4f1c8abe42007722747ccf67eb328da9b9e6b75e34900ca37e3caee1f8921893355b1d36abe50928b652659ff8c70a08d905',
    'mechmoss122715:VdVB2luwQ8:christinharu4171@outlook.com:GsYllabati:SDLW5ZU2UE4PMQDU:6630c6ee11c93a5dc6bd5f809c34abbfff9fa41b:b793ce042bf5006524250cebf16eed23fd77545a4981db45c47de54460234f26d2ced032d9cc2de8a61b09266da9d86c3a9d4724e504a941e182cf5a6691c3703b469ab0c2e98db792dcddfc5f3e03d3',
    'mechnebula37189:DDDmH0jBLhao:masukacaja1950@outlook.com:reHyIndivi:AJWCHT4MHHRH4IFX:b41fd12aad2d01df71a8b2e44878f46ed8632758:4805c9967f116aba58ab18e122fc01ac0e5f1fc8a7742650110fec1e0ba33d3ee8f46d169b02cc0184b7b397d74c89e5869eea98751db327ab5ceb35ec43184c8d9963f96bc68f73cb81352afbfbfc73',
    'mechnebula78617:U8hpII9Do9MQF:samirakoei5445@outlook.com:DveSTal09:FAGJOKJLJKDD35I5:5c16ffcf4cd812fc35a9df107ee7c6072f4f453a:27b1d0440a600eb32274a18311880ce894d0d9a564582b89987b0d98c91ea0587ecd18b79772518d26cf32c96d57c9168f88bcd5857155de735cb92407d4cdbdab18e138d8fe2185c1b2950cfbe71002',
    'mechquasar32958:dyhVpTJTq2m7:angiolabrynh7132@outlook.com:DHstereoph:5WSPNU6EZATXKHWE:ea5a7fe2410b0e6850c0649c387c8152bf1d427a:98ea032ea79365760dfecfec303953a592047fdad71e8c47ce46a33f65ea0d85f450b0a3d873fc4e40cce3ea0e6648ee8cc6346e879161f7c4d39775f136f32037da79db86d9834430796a10d0a95817',
    'mechquasar81409:ghvEFPQLqVcvat:ann-britttim8878@outlook.com:ndiviDua2:F5SVLOQ2B5DXHMKF:29ed07f69d0b84e5c1a3701f6474d559d49230a0:98802551ae60fd3feb0b9d7c68c248b3ad797559e4e429c5b68d0811deae466b7e77a9a4d0ac0731d9c0767b73e3bd0e161babaaad4c57d48a6bcb3fe16b6efff14f0e6710b2070c5c55cd71cf652b6e',
    'mechstarli45246:MCfkRVQtSP:runi0466anka@outlook.com:seZnK81KC:7IFWGGFZOSJUTXBQ:33b1ada28b06a17715dcaaa69ce5e00343491984:20ed1689f4635de456f7a6ca2c892ba3dade2d07cfb95a46d15fec55dac493db7b385ee192874fcdbff8a1b4510bd5a04cc113a7ca3d5f1bc3a5cb379b5aaa17b90d7bc03c95cb4d6eb616ce13c3790c',
    'mechstarli50302:slPfvm3ryBgRX:chikaegrazyb6279@outlook.com:ndomIzatio:GKNAH7DFR6XTK33F:f6fbc5349312c16522cee6e4ebe1aacd4e36b908:3a98faa0e1dbfd88e599f1b182fc67b84564274ad5e9d7c1132bacf63e2a78a14586c059290e229a3d9f32cbacd5f8a6a1e4bae16c5cde9919eae1e48487bea184ee924cae58825e3f9a279f041356b4',
    'mechstarli52016:F4dQOTfWYGls:archanamario0287@outlook.com:eiNgCtM710:BNVHQ6OVWYJPXCNU:b111c4e2ef407c1765e71adf6f7407f34f40a8bd:3f8683368d254a5ece60b62e2644048605fd6ce3dc53427757e4e99dce862e6b6dc7e20b6ec16ada9fbd665eb6a52bba67c2a49bb8ae5c8ca05502a6cf2c4825699f89a7bdb39dbd4c06466688c0e380',
    'metaforge842167:mWZo2uT2eeV:thaissori7086@outlook.com:ctionaRiS0:T55J5BISO4FB2W4J:1e10c7d5a4e288d75a717693be30e497b5d3185a:15ffb966420f63ee4a47ecfeaf67935e628305815ff7b856524c434534a05cbe5b5856599285c8bb4aa67e082797f91a9e9e51ebb3eba385f5a2662e84e29219ad5351c123c892515658ecaed1447c99',
    'metaloom244887:vt1I9sCp0fI:bettaoldrisk2137@outlook.com:s2importAN:IAKCGCFARPGHDGMK:1d5200ab3fcd51af32e4e2557b63ec22f10deb6c:916513cca321c6f7a8acc2c4fbd84169aff51f24deca76815c4ef06b254e871b025ceea404f6d7b714bc2124eb5c3e14ebe9490c47f4774043c9824df4263159ec788af33a5da30cbb11a78368a6c5a4',
    'metaloom2415357:8GELDcyFBnN:reikohanka9611@outlook.com:1aX143MFj:KWVPABM33WGWYE66:2e1df4e2c4d0d86c3deb34a113e941a67cceaad6:886c84650aed61f5568beb53f6b87d13f65b9a24d34e1945250735175c5f9f9d2d6f0cdf5d2cc166aef5e9caf6766ac6cfa31f4eabf33584a04f5672b8b7978dc07b33812b8fbde1d314ddb36093ad92',
    'metaloom2488589:QXpGi3RKm3nt9O:kristinayumi2121@outlook.com:x396uYefH:N2LDPEVLCPPVKEWD:03e49940feb08410510be2b317c8c3a88b51dc2f:09f166dbcd2c66863e0097421321df93a3708e24f287d9048b95799ef112e9787c064102bd615551fb5f7d0122eba857004c455f190e3a50ebabc327d4eac4009a5f3d61c8ac5117a96bfbda73ca8ad2',
    'metaloom2489160:7aX59lsPMd70F:katharinedix9461@outlook.com:cP8unha25:3BDJYZSWE44M2OH4:2edff753590ac97730dd8057aa923237dae4efe8:d9cd39d049efd6b40937c26878a6ed9172b3958c77fe70892fb3c3472cdb6e8dc9c38b1ec88701ed780d477131e73a9606edf7d87f9c404951832240ca03bbea790bc80a410b859f818c47927b818ada',
    'metaspark189095:rID1lAA49Fa:coralyclairo3018@outlook.com:Y3648FJ8F:RDJVUGOTNMJKPX6Q:004295cee74e868e2a7d50a4b15f14439db346c4:a031f5b1f0c6b30e2a00d23cf1abf9c23be5718e937c5689dab8fbbc0550d310fb37afbd362c80d633c277d37f58907070351e0f40ede10c74b0804c9a7ac0615bc78e368264df4e70baac5d0c15488c',
    'metaspark197356:eyhny5rnOfQE:laualbertiod0210@outlook.com:185AcAcian:EX6JRVM65GOC4AI6:5bcc8d7ecb4390f5b145e7e8c530c8bc4cc363d6:4d74e562014930728592f209116ccedfc97721b449ab3ea7f5df4d7bc1e626aaa05979299038b29c7d2ddccacc498ddfc1e6e07e3db2d83ca8b8de2e1b0372d08fb6dc194690228cff208e490780a4f8',
    'muhendismi22713:U9V9bWkVhJSq:raphaelalehr1614@outlook.com:erOUslacTu:4BYVZVMGSXNQJ4OW:8cf28726cd6a04b62004a7a4db9b2b08b47862f3:ebd1761d82acf77438de43270a170746275026f103725388f2d18912d6edea0c14a17332bf259f3619bd523c2007e7f73985b9d7466bc56f639b0412391ca33c9bab6272d6850c23ccef0e9fbfc0b1c7',
    'nanoastrob74910:gNcoflfn8KwfM:serybeyaz1033@outlook.com:FAtherioGa:W6QPIRRQPXD2NUAS:a3c550f2c7d7d143453fcad08fd35b80cd882b25:588023bbeedca439cb9d0b8a88b19739b91c4eb8b92b78d5040a511e968e708922d87787475a8a8c7977d08d63b760858e680272e795a41e4c52132091754966f30ea91dd09ccf73183102ced7eb3285',
    'nanobionex37059:bHJt8YDkw7sLD:hisaenikaido3837@outlook.com:FivEK5O010:62KEXHK6OXSNQPGS:f913b341f3fd8468af876aaf1cfda40d1a605c0f:efea864121a3373f958f3a8e330d7120209f4a6e1a3f631a25d4a80a4040a111b88d30c0386862a8a37c68224693deca03836f703f574eb768fa0e7706d9e3f6c8587d7df3cb6cfea61dcdab1b67fa8a',
    'nanoblosso8679:PWaTeSzwNlQim:josimiyoshik3133@outlook.com:cO881Q5T94:FDN36X2VFY7GLBUV:767c2ebd4051d4ca632d22232aef66395d6fd8a9:4130329501982fe6e7e1be18392175270c4ebbdbe110d92d23aaa5bf07b32dbed568d8e7acd63803158ee2f74d45b363d1faa85270e4241132cbc022230efac0826aeefd6b25c063633a2662b527a7e6',
    'nanocanopy11481:iuS2tCZGxQD4M:terulefukiko4984@outlook.com:8unmistrUs:UJX3ULSHFYX5X5GG:890526a8a992234638e258b77c44a7ebcc521935:f9483bbfe03af964730a1db8e781d988a135bdb449a9eae6dc6113ac8bba635dad9dc9fefdc3efad7d9e39d27a2907640d5c9ab1564c5a9cfb793f231fbbb5582df6a27d5a4231eab8d37fd41225fb97',
    'nanocanopy88346:0nCWGLHo3aH6b:ladanmacdona5411@outlook.com:60322NL9NE:A7DG4XLWB2AT64OG:56cb93c867bbefc6c336902f89b57bee653d0125:dac0dbe35bf4a194ffe8d112dbdf4b5b335551103123a44412de76a9e6f9bd960fbb9db0967d385498ba0e370bb71d48ed4eefc8f2c667badbded24c742c02def8e4007b3f50824d7cbc9d06cfc1edf4',
    'nanocosmos42845:MQQwJxGxDHby:gessicainann8125@outlook.com:lvcontinUe:CSDXORBVVXK37X5P:08346f765e83715444da37d5e9f9d22c69e1aec3:ffd840ddc2949df95a61b9f790181f7f1f42243fdd76481190becfe7c18d8f30bf26d7ec5a368f82aadaba949c00ce9634ddbb361d5113c922bd4bb261d637e5cec5f55a7ed0dd5d59c4b1f10839fd6e',
    'nanocurato25982:cETc7an2EfskKV:manuellebena0397@outlook.com:ScopyNQ2sw:P7HN2YDFGH24G23E:4c433ab32758d28efaee82529f5a9d0893e65dc8:8ddb586a7ea40345e3000c5dcbb4f60c1a7a180628a1dae404609efdc8b4c7ee8e256ed63108e3a2f1216790f66e6c953e46a3f1f45d981ef5d9034d7b0c2e0329e8a23e9a4c8f72ba8c99df1d714a2a',
    'nanocurato67587:GehkgMVZYFYw:arianneabbyt2126@outlook.com:71DEliciou:HKL6BVPIMHHSQV75:af7f04577b52a3625c9e259b5dcb1cac2860b775:2d639d58536dfe27774cdd26cc150fea6ce6d366ca3609227a6aa2cdc03af4964be9ef3dba28e8732ed07341e6c8f85e086790e9c272b63f6b9b4c51fad217b8e49eda44ceb112f7d29ff8548a803e3c',
  ];

  const accountIds = new Set<string>();
  for (const line of dataLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const parts = trimmed.split(':');
    if (parts.length >= 1) {
      accountIds.add(parts[0]);
    }
  }
  return accountIds;
}

/**
 * コンテナ名を取得
 */
function getContainerName(overridesJson: string): string {
  try {
    const overrides = JSON.parse(overridesJson || '{}');
    return String(overrides.container_name || '不明');
  } catch (e) {
    return '不明';
  }
}

/**
 * タスクの実行結果を判定
 */
function getTaskResult(task: Task, taskRun: TaskRun | null): 'success' | 'failed' | 'running' | 'pending' {
  if (!taskRun) {
    return task.status === 'completed' ? 'success' : 'pending';
  }

  if (taskRun.ended_at === null) {
    return 'running';
  }

  // result_jsonを確認
  if (taskRun.result_json) {
    try {
      const result = JSON.parse(taskRun.result_json);
      // 最後のステップの結果を確認
      if (result.steps && Array.isArray(result.steps)) {
        const lastStep = result.steps[result.steps.length - 1];
        if (lastStep && lastStep.ok === false) {
          return 'failed';
        }
      }
      // 全体の結果を確認
      if (result.ok === false || result.error) {
        return 'failed';
      }
    } catch (e) {
      // JSON解析エラーは無視
    }
  }

  // statusを確認
  if (taskRun.status === 'completed' || taskRun.status === 'success') {
    return 'success';
  }
  if (taskRun.status === 'failed' || taskRun.status === 'error') {
    return 'failed';
  }

  // ended_atがあれば成功とみなす（デフォルト）
  return 'success';
}

function main() {
  initDb({ wal: true });

  console.log('🔍 ログインタスクの実行結果を確認中...\n');

  // 今回登録した100件のアカウントIDを取得
  const targetAccountIds = getTargetAccountIds();
  console.log(`今回登録したアカウント数: ${targetAccountIds.size}件\n`);

  // プリセット17のタスクを取得
  const allTasks = query<Task>(
    'SELECT id, runId, container_id, status, overrides_json, created_at FROM tasks WHERE preset_id = 17 ORDER BY created_at ASC',
    []
  );

  console.log(`プリセット17のタスク数: ${allTasks.length}件\n`);

  // 今回登録した100件のアカウントに対するタスクをフィルタ
  const targetTasks: Task[] = [];
  for (const task of allTasks) {
    try {
      const overrides = JSON.parse(task.overrides_json || '{}');
      const containerName = String(overrides.container_name || '');
      if (targetAccountIds.has(containerName)) {
        targetTasks.push(task);
      }
    } catch (e) {
      // JSON解析エラーは無視
    }
  }

  console.log(`対象タスク数: ${targetTasks.length}件\n`);

  if (targetTasks.length === 0) {
    console.log('❌ 対象タスクが見つかりませんでした');
    return;
  }

  // 各タスクの実行結果を確認
  const results: Array<{
    containerName: string;
    runId: string;
    status: 'success' | 'failed' | 'running' | 'pending';
    taskStatus: string;
    taskRunStatus: string | null;
    endedAt: number | null;
  }> = [];

  for (const task of targetTasks) {
    const containerName = getContainerName(task.overrides_json);
    
    // task_runsを取得
    const taskRuns = query<TaskRun>(
      'SELECT runId, started_at, ended_at, status, result_json FROM task_runs WHERE runId = ? ORDER BY started_at DESC LIMIT 1',
      [task.runId]
    );
    
    const taskRun = taskRuns && taskRuns.length > 0 ? taskRuns[0] : null;
    const result = getTaskResult(task, taskRun);
    
    results.push({
      containerName,
      runId: task.runId,
      status: result,
      taskStatus: task.status,
      taskRunStatus: taskRun?.status || null,
      endedAt: taskRun?.ended_at || null,
    });
  }

  // 結果を集計
  const success = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const running = results.filter(r => r.status === 'running').length;
  const pending = results.filter(r => r.status === 'pending').length;

  // 結果を表示
  console.log('='.repeat(60));
  console.log('📊 実行結果サマリ');
  console.log('='.repeat(60));
  console.log(`対象タスク数: ${targetTasks.length}件`);
  console.log(`✓ 成功: ${success}件`);
  console.log(`✗ 失敗: ${failed}件`);
  console.log(`⏳ 実行中: ${running}件`);
  console.log(`⏸ 待機中: ${pending}件`);
  console.log('='.repeat(60));

  // 失敗したタスクを表示
  if (failed > 0) {
    console.log('\n❌ 失敗したタスク:');
    for (const r of results.filter(r => r.status === 'failed')) {
      console.log(`  - ${r.containerName} (Run ID: ${r.runId})`);
      console.log(`    Task Status: ${r.taskStatus}, TaskRun Status: ${r.taskRunStatus || 'N/A'}`);
    }
  }

  // 実行中・待機中のタスクを表示
  if (running > 0 || pending > 0) {
    console.log('\n⏳ 実行中・待機中のタスク:');
    for (const r of results.filter(r => r.status === 'running' || r.status === 'pending')) {
      console.log(`  - ${r.containerName} (Run ID: ${r.runId}) - ${r.status === 'running' ? '実行中' : '待機中'}`);
    }
  }

  // 成功したタスクの一部を表示（最初の5件）
  if (success > 0) {
    console.log('\n✓ 成功したタスク（最初の5件）:');
    for (const r of results.filter(r => r.status === 'success').slice(0, 5)) {
      const endedAtStr = r.endedAt ? new Date(r.endedAt).toLocaleString('ja-JP') : 'N/A';
      console.log(`  - ${r.containerName} (完了: ${endedAtStr})`);
    }
    if (success > 5) {
      console.log(`  ... 他 ${success - 5}件`);
    }
  }

  console.log('\n' + '='.repeat(60));
  if (success === targetTasks.length) {
    console.log('✅ すべてのタスクが成功しました！');
  } else {
    console.log(`⚠ ${targetTasks.length - success}件のタスクが未完了または失敗しています`);
  }
  console.log('='.repeat(60));
}

try {
  main();
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}


