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

各職業的配色是在瀏覽器裡把貼圖重新上色（`client/game/look.ts`），頭盔羽飾、光環、長槍等配件、Boss、場地、特效與介面都是程式產生，沒有用到其他外部素材。
