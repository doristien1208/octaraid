# 素材來源

角色、武器與動作是 Kay Lousberg（www.kaylousberg.com）的 CC0 素材：可以自由使用、修改與商用，不必標示出處；這裡記下來源，方便以後追溯或更新。

| 專案裡的檔案 | 來源 | 授權 |
| --- | --- | --- |
| `client/public/models/knight.glb`、`barbarian.glb`、`mage.glb`、`ranger.glb`、`rogue.glb`、`rogue_hooded.glb` | [KayKit - Character Pack : Adventurers](https://kaylousberg.itch.io/kaykit-adventurers) 2.0 免費版 | CC0 1.0 |
| `client/public/models/props.glb`（sword_1handed、shield_square_color、axe_2handed、staff、wand、bow_withString、spellbook_open） | 同上 | CC0 1.0 |
| `client/public/models/anims.glb`（33 個動作） | [KayKit - Character Animations](https://kaylousberg.itch.io/kaykit-character-animations) 1.1 免費版 | CC0 1.0 |

這些檔案由 `scripts/pack-models.mjs` 從兩包素材產生，只留下遊戲用到的部分：

```bash
node scripts/pack-models.mjs <KayKit_Adventurers_2.0_FREE 資料夾> <KayKit_Character_Animations_1.1 資料夾>
```

各職業的配色是在瀏覽器裡把貼圖重新上色（`client/game/look.ts`），頭盔羽飾、光環、長槍等配件、Boss、場地、特效與介面都是程式產生；除了下面的技能圖示，沒有用到其他外部素材。

## 技能圖示

技能、疾走與極限技的圖示來自 [game-icons.net](https://game-icons.net)（[GitHub: game-icons/icons](https://github.com/game-icons/icons)，2026-11-06 下載）。授權是 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)，Zeromancer 的圖是 CC0。CC BY 要求標示作者、授權與是否修改過，所以遊戲的「設定」視窗也有一行出處。

原始檔原封不動放在 `client/icons/<作者>/<圖名>.svg`，作者名單與授權說明是同一資料夾的 `license.txt`。遊戲顯示時改過圖：拿掉黑色底，把剪影改成白色，再放到依技能用途上色的方塊上（`client/skill-icons.ts`）。

| 作者 | 用到的圖（遊戲裡的技能） |
| --- | --- |
| [Lorc](http://lorcblog.blogspot.com)（60 張） | sword-slice（三連斬）、shouting（挑釁）、checked-shield（堅盾）、locked-fortress（不動要塞）、shield-echoes（守護結界）、sword-spin（聖盾迴旋）、shield-reflect（守護之誓）、shining-sword（誓約之刃）、cross-flare（破邪之光）、axe-swing（劈砍連擊）、sonic-shout（戰吼）、bleeding-heart（嗜血）、skull-shield（死戰）、earth-crack（裂地斬）、battle-axe（擲斧）、wolf-howl（戰嚎）、sun（聖光彈）、beams-aura（光環禱言）、angel-wings（神恩）、ankh（復甦之光）、barbed-sun（烈日灼燒）、sunrise（晨光恩典）、prayer（祈福）、comet-spark（星屑彈）、eclipse（星蝕）、ringed-planet（星環結界）、punch（疾風連拳）、punch-blast（崩山拳）、whirlwind（疾風之心）、wingfoot（縮地）、wind-slap（裂空拳）、muscle-up（鐵身）、compass（八方步）、meditation（回氣）、spear-hook（穿雲連槍）、bleeding-wound（裂鱗刺）、rally-the-troops（戰意昂揚）、dodging（後躍）、blade-fall（天槍墜擊）、fast-arrow（速射）、supersonic-arrow（穿透箭）、striking-arrows（箭雨）、lyre（守護之歌）、hunting-horn（戰歌）、snake-bite（毒牙箭）、double-shot（連珠箭）、hawk-emblem（鷹眼凝神）、fireball（火球術）、fire-ring（爆炎術）、vortex（魔力湧泉）、meteor-impact（隕星）、teleport（焰影步）、magic-portal（歸泉）、burning-dot（灼燒咒）、fire-shield（焰幕）、cursed-star（蝕力咒）、sprint（疾走）、surrounded-shield（鋼鐵誓約）、holy-grail（黎明讚歌）、zeus-sword（破軍一擊） |
| [Delapouite](http://delapouite.com)（13 張） | shield-bash（盾衝）、charging-bull（猛衝）、heart-shield（熱血庇護）、healing（治癒術）、bolt-spell-cast（迅唱）、healing-shield（星盾術）、star-formation（群星庇護）、star-altar（星界領域）、heart-wings（星還術）、sparkles（星輝）、high-kick（旋風踢）、jump-across（天降擊）、dragon-shield（龍鱗） |
| Skoll（3 張） | hearts（群體治癒）、allied-star（星辰守護）、drop-weapon（卸力） |
| [DarkZaitzev](http://darkzaitzev.deviantart.com)（1 張） | acrobatic（後空翻射擊） |
| Zeromancer（1 張，CC0） | heart-plus（狂血） |

換圖或加新技能時：從 `https://raw.githubusercontent.com/game-icons/icons/master/<作者>/<圖名>.svg` 下載單一個 SVG 放進 `client/icons/<作者>/`，再到 `client/skill-icons.ts` 填技能名稱、圖名與顏色，最後更新上面的表。`npm test` 會檢查每個技能都有圖，而且資料夾裡沒有用不到的檔案。
