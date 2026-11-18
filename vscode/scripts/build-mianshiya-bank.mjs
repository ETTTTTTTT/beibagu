/**
 * 基于面试鸭公开题目标题生成背题 JSON（答案为自研面试答法，非站点原文）。
 * 来源目录：https://www.mianshiya.com/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const rawPath = path.join(root, 'data', 'mianshiya-raw.json');
const outPath = path.join(root, 'data', 'mianshiya-import.json');

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

const curated = {
  '说说 Java 中 HashMap 的原理？': `HashMap 基于数组 + 链表（JDK8 起链表过长转红黑树）实现哈希表。
1) put：算 hash，定位桶；冲突则拉链；树化阈值默认 8，且数组长度≥64。
2) get：同样 hash 定位，比较 equals。
3) 扩容：默认负载因子 0.75，容量翻倍并重新分布。
4) 关键点：允许 null key/value；非线程安全；遍历无序（JDK8 不完全保证插入序）。
面试可补充：扰动函数、尾插法（JDK8）、扩容时高低位拆分。`,

  'Java 中 ConcurrentHashMap 1.7 和 1.8 之间有哪些区别？': `1.7：分段锁 Segment + HashEntry，锁粒度是段。
1.8：取消 Segment，数组 + 链表/红黑树；用 CAS + synchronized 锁桶头节点，锁粒度更细。
1.8 扩容支持多线程协助迁移；size 用 CounterCell 近似统计。
结论：1.8 并发度更高、结构更接近 HashMap。`,

  '为什么 JDK 1.8 对 HashMap 进行了红黑树的改动？': `链表过长时，查找从 O(n) 退化。红黑树把最坏查找降到 O(log n)。
触发：单桶链表长度≥8 且数组容量≥64 才树化；过小先扩容。
退化：树节点过少（≤6）会转回链表，平衡空间与复杂度。`,

  'JDK 1.8 对 HashMap 除了红黑树还进行了哪些改动？': `1) 头插改尾插，避免扩容死链（并发下旧问题）。
2) 扩容时用 hash 高位决定留在原位还是 i+oldCap，效率更高。
3) hash 扰动简化；Node 替代 Entry。
4) 引入 TreeNode；优化扩容与树化阈值配合。`,

  'Java 中有哪些集合类？请简单介绍': `Collection 三大支：
- List：ArrayList（数组）、LinkedList（双向链表）、Vector（同步，少用）
- Set：HashSet、LinkedHashSet、TreeSet
- Queue/Deque：ArrayDeque、PriorityQueue、LinkedList
Map 另成体系：HashMap、LinkedHashMap、TreeMap、Hashtable、ConcurrentHashMap。
按场景选：随机访问→ArrayList；频繁头尾插入→LinkedList/ArrayDeque；去重→HashSet；排序→Tree*；并发→Concurrent*。`,

  'MySQL 索引的最左前缀匹配原则是什么？': `联合索引 (a,b,c) 会按最左连续列匹配：可用 a、(a,b)、(a,b,c)；不能跳过 a 直接用 b、c。
like 'abc%' 可用；'%abc' 通常不可用。
范围条件后可能让后续列失效（优化器版本有差异，但答题按经典规则说）。`,

  '数据库的脏读、不可重复读和幻读分别是什么？': `脏读：读到未提交数据，对方回滚则读到脏数据。
不可重复读：同一事务两次读同一行，中间被更新，结果不同。
幻读：同一范围条件两次查询，行数变化（插入/删除）。
隔离级别：读未提交→脏读；读已提交→防脏读；可重复读→防不可重复读（InnoDB 用 MVCC+间隙锁近似防幻）；串行化最强最慢。`,

  'MySQL 的存储引擎有哪些？它们之间有什么区别？': `常见：InnoDB、MyISAM、Memory 等。
InnoDB：默认，事务、行锁、外键、崩溃恢复、聚簇索引。
MyISAM：表锁，非事务，曾适合只读；现较少用于主业务。
Memory：内存表，快但不持久。
业务库几乎都选 InnoDB。`,

  'MySQL 的覆盖索引是什么？': `查询所需列都能被索引覆盖，无需回表拿整行。
例：索引 (a,b)，查询 select a,b from t where a=? 可覆盖。
好处：减少 IO，提升性能。explain 中 Using index 常表示覆盖。`,

  'MySQL 的索引类型有哪些？': `按结构：B+树索引（主流）、哈希（Memory）、全文、空间索引。
按特性：主键、唯一、普通、前缀、联合索引。
InnoDB 主键是聚簇索引；二级索引存主键值。`,

  'MySQL InnoDB 引擎中的聚簇索引和非聚簇索引有什么区别？': `聚簇索引：数据和主键索引在一起，叶节点是整行。
二级（非聚簇）索引：叶节点存主键值，需再回表。
一张表一个聚簇索引；无显式主键时 InnoDB 会隐式生成。`,

  'MySQL 中的回表是什么？': `通过二级索引找到主键后，再回聚簇索引取完整行，叫回表。
覆盖索引可避免回表。大量回表可能不如全表扫描，需结合优化器。`,

  'RabbitMQ 怎么实现延迟队列？': `常见：TTL + 死信交换机（消息过期进入 DLX 再路由到业务队列）；或延迟插件 rabbitmq_delayed_message_exchange。
注意：队列级 TTL 会阻塞头阻塞；插件更适合灵活延迟。`,

  'JDK 和 JRE 和 JVM 分别是什么，有什么区别？': `JVM：虚拟机，负责字节码执行与内存管理。
JRE：运行环境 = JVM + 核心库，可运行程序。
JDK：开发工具包 = JRE + javac 等工具，用来开发编译。
关系：JDK ⊃ JRE ⊃ JVM。`,

  '什么是字节码？采用字节码的最大好处是什么？': `字节码是 .class 中的中间码，与具体 OS/CPU 无关。
好处：一次编译、到处运行；由 JVM 解释/JIT 成机器码。也便于安全校验与运行时优化。`,

  'String 和 StringBuffer、StringBuilder 的区别是什么？': `String 不可变，改内容会新建对象。
StringBuilder 可变、非线程安全、性能好。
StringBuffer 可变、方法同步、多线程更安全但慢。
单线程拼接优先 StringBuilder。`,

  '接口和抽象类有什么区别？': `抽象类：可有成员变量、构造、普通/抽象方法；单继承。
接口：更侧重能力契约；可多实现；Java8+ 可有 default/static。
选型：is-a 且共享实现→抽象类；can-do 能力组合→接口。`,

  'Java 中 Exception 和 Error 有什么区别？': `都是 Throwable。
Exception：可预期异常，分受检/非受检，应处理或声明。
Error：严重系统错误（如 OOM），通常不捕获业务处理。
实践：捕获具体异常，避免吞掉异常。`,

  '什么是 Java 的多态特性？': `同一行为因对象实际类型不同而有不同实现。
实现：继承/接口 + 方法重写 + 向上转型。
编译看父类型，运行调子类实现（动态绑定）。好处：扩展性、可替换。`,

  'Java 中的参数传递是按值还是按引用？': `一律按值传递。
基本类型：传值副本。
对象类型：传的是引用的副本（指向同一对象）；方法内改引用指向不影响外部变量，但改对象字段外部可见。`,
};

function inferCategories(q) {
  const tags = Array.isArray(q.tagList) ? q.tagList.filter(Boolean) : [];
  const title = q.title || '';
  const cats = [...tags];
  const rules = [
    [/HashMap|ConcurrentHashMap|集合|ArrayList|LinkedList|TreeMap|HashSet/, 'Java 集合'],
    [/线程|并发|锁|synchronized|volatile|AQS|CAS|Thread/, 'Java 并发'],
    [/JVM|GC|垃圾|类加载|双亲|堆|元空间|JIT/, 'JVM'],
    [/MySQL|索引|事务|InnoDB|B\+|隔离|慢查询/, 'MySQL'],
    [/Redis|缓存|分布式锁|过期|持久化|哨兵/, 'Redis'],
    [/SpringBoot|自动配置|starter/, 'SpringBoot'],
    [/SpringCloud|Gateway|Nacos|Feign|Sentinel/, 'SpringCloud'],
    [/Spring(?!Boot|Cloud)|IOC|AOP|Bean|依赖注入/, 'Spring'],
    [/RabbitMQ|Kafka|RocketMQ|消息队列|死信|延迟队列/, '消息队列'],
    [/MyBatis/, 'MyBatis'],
    [/网络|HTTP|TCP|UDP|OSI/, '计算机网络'],
    [/操作系统|进程|内存管理|死锁/, '操作系统'],
    [/设计模式|单例|工厂|代理/, '设计模式'],
    [/Java|JDK|JRE|多态|反射|泛型|异常|String/, 'Java 基础'],
  ];
  for (const [re, name] of rules) {
    if (re.test(title) && !cats.includes(name)) cats.push(name);
  }
  if (!cats.length) cats.push('面试鸭');
  if (!cats.includes('面试鸭')) cats.push('面试鸭');
  return [...new Set(cats)];
}

function topicAnswer(title, cats) {
  const t = title;
  if (/索引|B\+|回表|覆盖索引|最左/.test(t)) {
    return `结论：MySQL InnoDB 主流用 B+ 树索引，叶节点有序且双向链表，适合范围查。
要点：
1) 聚簇索引存整行；二级索引存主键，可能回表。
2) 联合索引遵循最左前缀；覆盖索引可避免回表。
3) 不是索引越多越好：写放大、空间占用、优化器误选。
排查：explain 看 type/key/rows/Extra；结合慢日志与基数。
加分：索引下推、ICP、函数会导致索引失效的常见写法。`;
  }
  if (/事务|隔离|脏读|幻读|不可重复/.test(t)) {
    return `结论：事务 ACID；并发问题有脏读/不可重复读/幻读；靠隔离级别与锁/MVCC 解决。
InnoDB 默认可重复读，用 MVCC + Next-Key Lock 处理多数幻读场景。
答题结构：定义问题 → 隔离级别对照表 → InnoDB 实现 → 业务选型（别盲目串行化）。`;
  }
  if (/Redis|缓存|过期|雪崩|击穿|穿透|分布式锁/.test(t)) {
    return `结论：Redis 是内存数据结构存储，常作缓存、分布式锁、计数、会话等。
常考：5 种基础类型与场景；持久化 RDB/AOF；过期与淘汰；集群/哨兵。
缓存三问题：穿透（布隆/空值）、击穿（互斥锁/逻辑过期）、雪崩（过期分散/多级缓存）。
分布式锁：SET key value NX EX + 持有者校验删除；红锁慎用，优先看业务容错。`;
  }
  if (/Spring|IOC|AOP|Bean|循环依赖/.test(t)) {
    return `结论：Spring 核心是 IoC（容器管依赖）与 AOP（横切逻辑）。
Bean 生命周期：实例化 → 属性填充 → 初始化回调 → 销毁。
循环依赖：单例三级缓存思路（早期引用）；构造器循环依赖无法解决。
Boot 自动配置：条件注解 + starter + spi/imports，约定优于配置。`;
  }
  if (/线程|并发|锁|synchronized|volatile|ThreadPool|线程池/.test(t)) {
    return `结论：并发关键是可见性、原子性、有序性。
synchronized：监视器锁，可重入；锁升级偏向→轻量→重量。
volatile：可见性与有序性，不保证复合操作原子性。
线程池：核心参数（core/max/queue/reject）；线上要监控队列与拒绝策略。
加分：AQS、CAS、happens-before。`;
  }
  if (/JVM|GC|垃圾|堆|元空间|类加载/.test(t)) {
    return `结论：JVM 管内存与执行；面试重点是运行时数据区、GC、类加载。
堆分新生代/老年代；GC 算法与收集器要能对比场景。
类加载：加载-验证-准备-解析-初始化；双亲委派防核心类被篡改。
排查：heap dump、GC 日志、jstack/jmap/arthas。`;
  }
  if (/Kafka|RabbitMQ|RocketMQ|消息|死信|延迟/.test(t)) {
    return `结论：消息队列用于解耦、削峰、异步。
可靠投递：生产者确认、持久化、消费者手动 ack、重试与死信。
幂等：唯一键、业务去重表、状态机。
顺序：单分区/单队列有序；乱序要用业务键路由。
选型：吞吐量/生态/延迟/运维成本综合看。`;
  }
  if (/HashMap|ConcurrentHashMap|集合|ArrayList|LinkedList/.test(t)) {
    return `结论：先说数据结构与复杂度，再谈线程安全与扩容。
ArrayList 数组随机访问快；LinkedList 链表改动局部快但局部性差。
HashMap：数组+链表/红黑树，非线程安全。
ConcurrentHashMap：CAS+桶锁，适合并发读多写。
答完给一个项目选型例子更加分。`;
  }
  const topic = cats.filter((c) => c !== '面试鸭')[0] || '该知识点';
  return `【自研面试答法｜题干参考面试鸭公开列表】
${t}

建议按 4 段答：
1) 一句话结论（面向 ${topic}）
2) 核心原理/流程（3 点）
3) 对比与适用场景
4) 项目实践与排查

把名词落到你做过的系统上，比背长文更有效。`;
}

function difficultyLabel(d) {
  if (d === 1) return '简单';
  if (d === 2) return '中等';
  if (d === 3) return '中等';
  if (d >= 4) return '困难';
  return '';
}

const questions = raw.records.map((q, i) => {
  const categories = inferCategories(q);
  const answer = curated[q.title] || topicAnswer(q.title, categories);
  const diff = difficultyLabel(q.difficulty);
  return {
    id: `msy-${q.id}`,
    type: 'short',
    question: q.title,
    answer,
    analysis: diff ? `难度：${diff}；来源题目标题参考面试鸭公开列表` : '来源题目标题参考面试鸭公开列表',
    categories,
    topic: categories[0] || '面试鸭',
    category: categories.join(' / '),
    sourceUrl: `https://www.mianshiya.com/`,
  };
});

const out = {
  meta: {
    title: '面试鸭公开题目录（自研答案）',
    questionCount: questions.length,
    source: 'https://www.mianshiya.com/',
    sourceNote:
      '题目标题来自面试鸭公开列表 API；答案为本地生成的面试答法，不是站点付费原文。仅供个人背题。',
    importedAt: new Date().toISOString(),
  },
  questions,
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('wrote', outPath, 'count', questions.length);
console.log('curated answers', Object.keys(curated).length);
console.log('sample categories', [...new Set(questions.flatMap((q) => q.categories))].slice(0, 20));
