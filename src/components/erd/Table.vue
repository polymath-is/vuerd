<template lang="pug">
  .table(
    :class="{active: table.ui.active}"
    :style="tableStyle"
    @mousedown="onMousedown"
    @touchstart="onTouchstart"
  )
    .table-header
      .table-header-top
        CircleButton.table-button(
          title="Ctrl + Delete"
          close
          @click="onClose"
        )
        CircleButton.table-button(
          title="Alt + Enter"
          add
          @click="onColumnAdd"
        )
      .table-header-body
        TableName(
          :edit="edit && edit.id === table.id && edit.focusType === 'tableName'"
          :table="table"
          :tableFocus="store.tableStore.state.tableFocus"
          :width="table.ui.widthName"
          @blur="onEditBlur"
          @input="onEditInput($event, 'tableName')"
          @mousedown="onFocus($event, 'tableName')"
          @dblclick="onDblclick($event, 'tableName')"
        )
        TableComment(
          v-if="show.tableComment"
          :edit="edit && edit.id === table.id && edit.focusType === 'tableComment'"
          :table="table"
          :tableFocus="store.tableStore.state.tableFocus"
          :width="table.ui.widthComment"
          @blur="onEditBlur"
          @input="onEditInput($event, 'tableComment')"
          @mousedown="onFocus($event, 'tableComment')"
          @dblclick="onDblclick($event, 'tableComment')"
        )
    transition-group.table-body(
      :name="transitionName"
      tag="ul"
      ref="group"
    )
      Column(
        v-for="(column, index) in table.columns"
        :key="column.id"
        :store="store"
        :table="table"
        :column="column"
        :columnFocus="columnFocus(index)"
      )
</template>

<script lang="ts">
import { SIZE_TABLE_PADDING, SIZE_MIN_WIDTH } from "@/ts/layout";
import { Table as TableModel, Edit, ColumnTable, Commit } from "@/store/table";

import { Show } from "@/store/canvas";
import { FocusType } from "@/models/TableFocusModel";
import { ColumnFocus } from "@/models/ColumnFocusModel";
import AnimationFrame from "@/ts/AnimationFrame";
import { Bus } from "@/ts/EventBus";
import {
  log,
  getTextWidth,
  autoName,
  findParentLiByElement,
  getData
} from "@/ts/util";
import StoreManagement from "@/store/StoreManagement";
import { relationshipSort } from "@/store/relationship/relationshipHelper";
import { Component, Prop, Watch, Vue } from "vue-property-decorator";
import Column from "./Table/Column.vue";
import CircleButton from "./CircleButton.vue";
import TableName from "./Table/TableName.vue";
import TableComment from "./Table/TableComment.vue";

import { fromEvent, Observable, Subscription, Subject } from "rxjs";
import { throttleTime, debounceTime } from "rxjs/operators";

const TABLE_PADDING = SIZE_TABLE_PADDING * 2;

@Component({
  components: {
    Column,
    CircleButton,
    TableName,
    TableComment
  }
})
export default class Table extends Vue {
  @Prop({ type: Object, default: () => ({}) })
  private store!: StoreManagement;
  @Prop({ type: Boolean, default: false })
  private focus!: boolean;
  @Prop({ type: Object, default: () => ({}) })
  private table!: TableModel;

  private mouseup$: Observable<MouseEvent> = fromEvent<MouseEvent>(
    window,
    "mouseup"
  );
  private mousemove$: Observable<MouseEvent> = fromEvent<MouseEvent>(
    window,
    "mousemove"
  );
  private touchmove$: Observable<TouchEvent> = fromEvent<TouchEvent>(
    window,
    "touchmove"
  );
  private touchend$: Observable<TouchEvent> = fromEvent<TouchEvent>(
    window,
    "touchend"
  );
  private keydown$: Observable<KeyboardEvent> = fromEvent<KeyboardEvent>(
    window,
    "keydown"
  );
  private subMouseup: Subscription | null = null;
  private subMousemove: Subscription | null = null;
  private subTouchmove: Subscription | null = null;
  private subTouchend: Subscription | null = null;
  private subKeydown: Subscription | null = null;
  private touchX: number = 0;
  private touchY: number = 0;

  private draggableListener: Subscription[] = [];
  private draggable$: Subject<DragEvent> = new Subject();
  private subDraggable: Subscription | null = null;

  private moveXAnimation: AnimationFrame<{ x: number }> | null = null;
  private moveYAnimation: AnimationFrame<{ y: number }> | null = null;
  private transitionName: string = "";

  get tableStyle(): string {
    return `
        top: ${this.table.ui.top}px;
        left: ${this.table.ui.left}px;
        width: ${this.table.width()}px;
        height: ${this.table.height()}px;
        z-index: ${this.table.ui.zIndex};
      `;
  }

  get tableFocus(): boolean {
    let result = false;
    if (
      this.store.tableStore.state.tableFocus &&
      this.store.tableStore.state.tableFocus.id === this.table.id &&
      this.focus
    ) {
      result = true;
    }
    return result;
  }

  get show(): Show {
    return this.store.canvasStore.state.show;
  }

  get edit(): Edit | null {
    return this.store.tableStore.state.edit;
  }

  get columnDraggable(): ColumnTable | null {
    return this.store.tableStore.state.columnDraggable;
  }

  @Watch("tableFocus")
  private watchTableFocus(value: boolean) {
    log.debug("Table watchTableFocus");
    if (value) {
      if (this.subKeydown) {
        this.subKeydown.unsubscribe();
        this.subKeydown = null;
      }
      this.subKeydown = this.keydown$.subscribe(this.onKeydown);
    } else {
      if (this.subKeydown) {
        this.subKeydown.unsubscribe();
        this.subKeydown = null;
      }
    }
  }

  @Watch("table.columns")
  private watchColumns() {
    log.debug("Table watchColumns");
    if (
      this.store.tableStore.state.tableFocus &&
      this.store.tableStore.state.tableFocus.id === this.table.id
    ) {
      this.store.tableStore.state.tableFocus.watchColumns();
    }
  }

  private columnFocus(index: number): ColumnFocus | null {
    let result: ColumnFocus | null = null;
    if (
      this.store.tableStore.state.tableFocus &&
      this.store.tableStore.state.tableFocus.id === this.table.id
    ) {
      result = this.store.tableStore.state.tableFocus.focusColumns[index];
    }
    return result;
  }

  // ==================== Event Handler ===================
  private onMousedown(event: MouseEvent) {
    const el = event.target as HTMLElement;
    if (!el.closest(".table-button") && !el.closest(".column")) {
      this.subMouseup = this.mouseup$.subscribe(this.onMouseup);
      this.subMousemove = this.mousemove$.subscribe(this.onMousemove);
    }
    if (
      !el.closest(".table-name") &&
      !el.closest(".table-comment") &&
      !el.closest(".column")
    ) {
      this.store.tableStore.commit(Commit.tableSelect, {
        table: this.table,
        event,
        store: this.store
      });
    }
  }

  private onMouseup(event: MouseEvent) {
    if (this.subMouseup && this.subMousemove) {
      this.subMouseup.unsubscribe();
      this.subMousemove.unsubscribe();
    }
    this.store.eventBus.$emit(Bus.Table.moveAnimationEnd);
    this.store.eventBus.$emit(Bus.Memo.moveAnimationEnd);
  }

  private onMousemove(event: MouseEvent) {
    event.preventDefault();
    let movementX = event.movementX / window.devicePixelRatio;
    let movementY = event.movementY / window.devicePixelRatio;
    // firefox
    if (window.navigator.userAgent.toLowerCase().indexOf("firefox") !== -1) {
      movementX = event.movementX;
      movementY = event.movementY;
    }
    this.store.tableStore.commit(Commit.tableMove, {
      table: this.table,
      x: movementX,
      y: movementY,
      event,
      store: this.store
    });
  }

  private onTouchstart(event: TouchEvent) {
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
    const el = event.target as HTMLElement;
    if (!el.closest(".table-button") && !el.closest(".column")) {
      this.subTouchend = this.touchend$.subscribe(this.onTouchend);
      this.subTouchmove = this.touchmove$.subscribe(this.onTouchmove);
    }
    if (
      !el.closest(".table-name") &&
      !el.closest(".table-comment") &&
      !el.closest(".column")
    ) {
      this.store.tableStore.commit(Commit.tableSelect, {
        table: this.table,
        event,
        store: this.store
      });
    }
  }

  private onTouchend(event: TouchEvent) {
    if (this.subTouchend && this.subTouchmove) {
      this.subTouchend.unsubscribe();
      this.subTouchmove.unsubscribe();
    }
    this.store.eventBus.$emit(Bus.Table.moveAnimationEnd);
    this.store.eventBus.$emit(Bus.Memo.moveAnimationEnd);
  }

  private onTouchmove(event: TouchEvent) {
    const movementX = event.touches[0].clientX - this.touchX;
    const movementY = event.touches[0].clientY - this.touchY;
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
    this.store.tableStore.commit(Commit.tableMove, {
      table: this.table,
      x: movementX,
      y: movementY,
      event,
      store: this.store
    });
  }

  private onClose() {
    log.debug("Table onClose");
    this.store.tableStore.commit(Commit.tableRemove, {
      table: this.table,
      store: this.store
    });
  }

  private onMoveAnimationEnd() {
    if (this.moveXAnimation) {
      this.moveXAnimation.stop();
    }
    if (this.moveYAnimation) {
      this.moveYAnimation.stop();
    }
    let x = 0;
    let y = 0;
    const minWidth =
      this.store.canvasStore.state.width - (this.table.width() + TABLE_PADDING);
    const minHeight =
      this.store.canvasStore.state.height -
      (this.table.height() + TABLE_PADDING);
    if (this.table.ui.left > minWidth) {
      x = minWidth;
    }
    if (this.table.ui.top > minHeight) {
      y = minHeight;
    }
    if (this.table.ui.left < 0 || this.table.ui.left > minWidth) {
      this.moveXAnimation = new AnimationFrame(
        { x: this.table.ui.left },
        { x },
        200
      )
        .update(value => {
          this.table.ui.left = value.x;
          relationshipSort(
            this.store.tableStore.state.tables,
            this.store.relationshipStore.state.relationships
          );
        })
        .start();
    }
    if (this.table.ui.top < 0 || this.table.ui.top > minHeight) {
      this.moveYAnimation = new AnimationFrame(
        { y: this.table.ui.top },
        { y },
        200
      )
        .update(value => {
          this.table.ui.top = value.y;
          relationshipSort(
            this.store.tableStore.state.tables,
            this.store.relationshipStore.state.relationships
          );
        })
        .start();
    }
  }

  private onKeydown(event: KeyboardEvent) {
    log.debug("Table onKeydown");
    this.store.tableStore.commit(Commit.tableFocusMove, event);
  }

  private onFocus(event: MouseEvent, focusType: FocusType) {
    log.debug("Table onFocus");
    this.store.tableStore.commit(Commit.tableSelect, {
      table: this.table,
      event,
      store: this.store
    });
    if (this.tableFocus) {
      this.store.tableStore.commit(Commit.tableFocus, focusType);
    }
  }

  private onColumnAdd() {
    log.debug("Table onColumnAdd");
    this.store.tableStore.commit(Commit.columnAdd, {
      table: this.table,
      store: this.store
    });
    this.$nextTick(() => this.store.eventBus.$emit(Bus.ERD.change));
  }

  private onEditInput(event: Event, focusType: FocusType) {
    log.debug("Table onEditInput");
    const input = event.target as HTMLInputElement;
    let width = getTextWidth(input.value);
    if (SIZE_MIN_WIDTH > width) {
      width = SIZE_MIN_WIDTH;
    }
    switch (focusType) {
      case FocusType.tableName:
        this.table.ui.widthName = width;
        break;
      case FocusType.tableComment:
        this.table.ui.widthComment = width;
        break;
    }
    relationshipSort(
      this.store.tableStore.state.tables,
      this.store.relationshipStore.state.relationships
    );
    // eventBus.$emit(Bus.ERD.input);
  }

  private onEditBlur(event: Event) {
    log.debug("Table onEditBlur");
    const reName = autoName(
      this.store.tableStore.state.tables,
      this.table.id,
      this.table.name
    );
    if (this.table.name !== reName) {
      let width = getTextWidth(reName);
      if (SIZE_MIN_WIDTH > width) {
        width = SIZE_MIN_WIDTH;
      }
      this.table.ui.widthName = width;
      this.table.name = reName;
    }
    this.store.tableStore.commit(Commit.tableEditEnd, this.store);
  }

  private onDblclick(event: MouseEvent, focusType: FocusType) {
    log.debug("Table onDblclick");
    event.preventDefault();
    this.store.tableStore.commit(Commit.tableEditStart, {
      id: this.table.id,
      focusType
    });
  }

  private onDraggableStart() {
    log.debug("Table onDraggableStart");
    this.transitionName = "column";
    const vm = this.$refs.group as Vue;
    const ul = vm.$el as HTMLElement;
    ul.childNodes.forEach((column: ChildNode) => {
      this.draggableListener.push(
        fromEvent<DragEvent>(column as HTMLElement, "dragover")
          .pipe(throttleTime(300))
          .subscribe(this.onDragoverGroup)
      );
    });
  }

  private onDraggableEnd() {
    log.debug("Table onDraggableEnd");
    this.transitionName = "";
    this.draggableListener.forEach((draggable: Subscription) =>
      draggable.unsubscribe()
    );
    this.draggableListener = [];
  }

  private onDragoverGroup(event: DragEvent) {
    log.debug("Table onDragoverGroup");
    this.draggable$.next(event);
  }

  private onDragover(event: DragEvent) {
    log.debug("Table onDragover");
    const li = findParentLiByElement(event.target as HTMLElement);
    if (
      li &&
      li.dataset.id &&
      this.columnDraggable &&
      this.columnDraggable.column.id !== li.dataset.id
    ) {
      const column = getData(this.table.columns, li.dataset.id);
      if (column) {
        this.store.tableStore.commit(Commit.columnMove, {
          table: this.table,
          column,
          store: this.store
        });
      }
    }
  }

  // ==================== Event Handler END ===================

  // ==================== Life Cycle ====================
  private created() {
    this.store.eventBus.$on(
      Bus.Table.moveAnimationEnd,
      this.onMoveAnimationEnd
    );
    this.store.eventBus.$on(Bus.Table.draggableStart, this.onDraggableStart);
    this.store.eventBus.$on(Bus.Table.draggableEnd, this.onDraggableEnd);
  }

  private mounted() {
    if (this.tableFocus) {
      this.subKeydown = this.keydown$.subscribe(this.onKeydown);
    }
    this.subDraggable = this.draggable$
      .pipe(debounceTime(50))
      .subscribe(this.onDragover);
  }

  private destroyed() {
    this.store.eventBus.$off(
      Bus.Table.moveAnimationEnd,
      this.onMoveAnimationEnd
    );
    this.store.eventBus.$off(Bus.Table.draggableStart, this.onDraggableStart);
    this.store.eventBus.$off(Bus.Table.draggableEnd, this.onDraggableEnd);
    if (this.subKeydown) {
      this.subKeydown.unsubscribe();
      this.subKeydown = null;
    }
    if (this.subDraggable) {
      this.subDraggable.unsubscribe();
    }
  }

  // ==================== Life Cycle END ====================
}
</script>

<style scoped lang="scss">
.table {
  position: absolute;
  background-color: $color-table;
  opacity: 0.9;
  padding: $size-table-padding;
  font-size: $size-font + 2;

  &.active {
    border: solid $color-table-active 1px;
    box-shadow: 0 1px 6px $color-table-active;
  }

  .table-header {
    .table-header-top {
      overflow: hidden;

      .table-button {
        margin-left: 5px;
        float: right;
      }
    }

    .table-header-body {
      height: $size-table-header-height;

      .table-name,
      .table-comment {
        display: inline-flex;
        align-items: center;
        margin-right: $size-margin-right;
        border-bottom: solid $color-opacity $size-border-bottom;
        color: $color-font-active;

        &.focus {
          border-bottom: solid $color-focus $size-border-bottom;
        }

        &.placeholder {
          color: $color-font-placeholder;
        }
      }
    }
  }

  input {
    outline: none;
    border: none;
    opacity: 0.9;
    background-color: $color-table;
    color: $color-font-active;
    border-bottom: solid $color-edit $size-border-bottom;
    margin-right: $size-margin-right;
  }
}

/* animation */
.column-move {
  transition: transform 0.3s;
}

ul,
ol {
  list-style: none;
  padding: 0;
  margin: 0;
}
</style>
